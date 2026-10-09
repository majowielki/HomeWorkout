import { acceptDay, previewDay, type DayPreview } from '@/db/repositories/planningV2';
import { loadWeekContext } from '@/db/repositories/weekPlanV2';
import { findInProgressWorkout } from '@/db/repositories/workouts';
import { dayInput } from '@/domain/__tests__/dayV2Fixtures';
import { planDayV2 } from '@/domain/plan/dayV2';
import {
  ExtraSessionChangedError,
  extraOptions,
  loadExtraSession,
  previewExtraSession,
  startExtraSession,
} from '../actions';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'extra' }));
jest.mock('@/db/repositories/planningV2', () => ({ acceptDay: jest.fn(), previewDay: jest.fn() }));
jest.mock('@/db/repositories/weekPlanV2', () => ({ loadWeekContext: jest.fn() }));
jest.mock('@/db/repositories/workouts', () => ({ findInProgressWorkout: jest.fn() }));
const input = dayInput();
const context = () =>
  ({ ...input, trainedDates: new Set([input.asOf]) }) as unknown as ReturnType<
    typeof loadWeekContext
  >;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadWeekContext).mockReturnValue(context());
  jest.mocked(findInProgressWorkout).mockResolvedValue(null);
  jest.mocked(previewDay).mockImplementation((request) => {
    const live = {
      ...input,
      only: request.only,
      session: { ...input.session, sessionId: request.sessionId, kind: request.kind ?? 'main' },
    };
    const output = planDayV2(live);
    return { input: live, request, asOf: live.asOf, output, planHash: 'shown-hash' } as DayPreview;
  });
  jest
    .mocked(acceptDay)
    .mockReturnValue({ kind: 'committed', result: { sessionId: 'extra' }, sessionRevision: 1 });
});
it('previews selected movements through the day service and accepts the exact shown hash', async () => {
  const preview = previewExtraSession(['push-horizontal']);
  expect(previewDay).toHaveBeenCalledWith(
    { sessionId: 'extra', kind: 'extra', only: [{ slotId: 'push-horizontal' }] },
    expect.any(Date),
  );
  expect(await startExtraSession(preview)).toBe('extra');
  expect(acceptDay).toHaveBeenCalledWith(
    expect.objectContaining({ request: preview.request, expectedPlanHash: 'shown-hash' }),
  );
});
it('resumes an existing session without accepting another', async () => {
  jest
    .mocked(findInProgressWorkout)
    .mockResolvedValue({ id: 'running' } as NonNullable<
      Awaited<ReturnType<typeof findInProgressWorkout>>
    >);
  expect(await startExtraSession(previewExtraSession(['push-horizontal']))).toBe('running');
  expect(acceptDay).not.toHaveBeenCalled();
});
it.each(['unfinished', 'rest', 'new-date', 'no-plan', 'main-plan'] as const)(
  'rejects %s before writing',
  async (caseName) => {
    const shown = previewExtraSession(['push-horizontal']);
    const ctx = context();
    if (caseName === 'unfinished') ctx.trainedDates = new Set();
    if (caseName === 'rest')
      ctx.constraints = [
        {
          id: 'rest',
          kind: 'rest_day',
          from: input.asOf,
          until: input.asOf,
          muscles: [],
          reason: 'busy',
          source: 'user',
          note: null,
        },
      ];
    if (caseName === 'new-date') shown.asOf = '2000-01-01';
    if (caseName === 'no-plan') shown.planHash = null;
    if (caseName === 'main-plan') shown.request.kind = 'main';
    jest.mocked(loadWeekContext).mockReturnValue(ctx);
    await expect(startExtraSession(shown)).rejects.toBeInstanceOf(ExtraSessionChangedError);
    expect(acceptDay).not.toHaveBeenCalled();
  },
);
it('lets transactional acceptance refuse a stale recipe', async () => {
  jest
    .mocked(acceptDay)
    .mockReturnValue({ kind: 'conflict', code: 'STALE_INPUT', actualRevision: null });
  await expect(startExtraSession(previewExtraSession(['push-horizontal']))).rejects.toBeInstanceOf(
    ExtraSessionChangedError,
  );
});
it('evaluates options on the same actual work, including soreness', async () => {
  const sore = dayInput({
    daily: [{ date: input.asOf, sleepHours: 7, energy: 4, soreness: { quads: 4 } }],
  });
  const options = extraOptions(sore);
  expect(options.find((o) => o.slotId === 'squat')).toMatchObject({
    item: null,
    reason: 'DOMS_HIGH',
  });
  expect(options.some((o) => o.item !== null)).toBe(true);
  expect((await loadExtraSession()).done).toBe(true);
});
