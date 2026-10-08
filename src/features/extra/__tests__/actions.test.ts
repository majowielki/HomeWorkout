import { loadPlannerSource } from '@/db/repositories/plannerSource';
import { getDayBoundaryHour, getTrainingWeek } from '@/db/repositories/profile';
import { getCurrentBlock } from '@/db/repositories/trainingBlocks';
import { getActiveConstraints, getPlannedDays, getTrainedDates } from '@/db/repositories/weekPlan';
import { findInProgressWorkout, startExtraWorkout } from '@/db/repositories/workouts';
import { planCustom } from '@/domain/plan/extra';
import { extraInput } from '@/domain/__tests__/extraFixtures';
import { ExtraSessionChangedError, loadExtraSession, startExtraSession } from '../actions';

jest.mock('@/db/repositories/plannerSource', () => ({ loadPlannerSource: jest.fn() }));
jest.mock('@/db/repositories/profile', () => ({
  getDayBoundaryHour: jest.fn(),
  getTrainingWeek: jest.fn(),
}));
jest.mock('@/db/repositories/trainingBlocks', () => ({ getCurrentBlock: jest.fn() }));
jest.mock('@/db/repositories/weekPlan', () => ({
  getActiveConstraints: jest.fn(),
  getPlannedDays: jest.fn(),
  getTrainedDates: jest.fn(),
}));
jest.mock('@/db/repositories/workouts', () => ({
  findInProgressWorkout: jest.fn(),
  startExtraWorkout: jest.fn(),
}));
jest.mock('@/features/plan/slots', () => ({
  get SLOTS() {
    return jest
      .requireActual<typeof import('@/domain/__tests__/extraFixtures')>(
        '@/domain/__tests__/extraFixtures',
      )
      .extraInput().slots;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 8, 12));
  const input = extraInput();
  jest.mocked(loadPlannerSource).mockResolvedValue({
    ...input,
    sessions: [...input.sessions],
    rides: [...input.rides],
    daily: [...input.daily],
    profile: input.eligibility.profile,
    excludedIds: [],
    lastSessionDate: '2026-10-08',
    calibrations: {},
  });
  jest.mocked(getCurrentBlock).mockResolvedValue({ id: 'b', state: input.block });
  jest.mocked(getActiveConstraints).mockResolvedValue([]);
  jest.mocked(getPlannedDays).mockResolvedValue([]);
  jest.mocked(getTrainingWeek).mockResolvedValue({ restWeekdays: [] });
  jest.mocked(getTrainedDates).mockResolvedValue(new Set(['2026-10-08']));
  jest.mocked(findInProgressWorkout).mockResolvedValue(null);
  jest.mocked(getDayBoundaryHour).mockResolvedValue(3);
  jest.mocked(startExtraWorkout).mockResolvedValue('extra');
});
afterEach(() => jest.useRealTimers());

async function preview() {
  const live = await loadExtraSession();
  return planCustom(live.input, ['push']);
}
it('starts with a fresh validated plan and its choice, preserving the preview', async () => {
  const plan = await preview();
  expect(await startExtraSession(['push'], plan)).toBe('extra');
  expect(startExtraWorkout).toHaveBeenCalledWith(
    plan,
    expect.objectContaining({ items: [expect.objectContaining({ slotId: 'push', role: 'work' })] }),
  );
});
it('resumes instead of inserting a duplicate if another session appeared', async () => {
  const plan = await preview();
  jest.mocked(findInProgressWorkout).mockResolvedValue({ id: 'active' } as never);
  expect(await startExtraSession(['push'], plan)).toBe('active');
  expect(startExtraWorkout).not.toHaveBeenCalled();
});
it('marks an accepted coach session only after validation, with a link to the local proposal', async () => {
  const plan = await preview();
  await startExtraSession(['push'], plan, { proposalId: 'coach-preview' });
  expect(startExtraWorkout).toHaveBeenCalledWith(
    expect.objectContaining({
      source: 'ai_accepted',
      coachProposalId: 'coach-preview',
      kind: 'extra',
    }),
    expect.anything(),
  );
  expect(plan.source).toBeUndefined();
});
it.each(['date', 'not-done', 'rest', 'constraint', 'empty', 'changed-load'])(
  'rejects an outdated preview: %s',
  async (change) => {
    const plan = await preview();
    if (change === 'date') jest.setSystemTime(new Date(2026, 9, 9, 12));
    if (change === 'not-done') jest.mocked(getTrainedDates).mockResolvedValue(new Set());
    if (change === 'rest') jest.mocked(getTrainingWeek).mockResolvedValue({ restWeekdays: [3] });
    if (change === 'constraint')
      jest.mocked(getActiveConstraints).mockResolvedValue([
        {
          id: 'r',
          kind: 'avoid_muscle',
          muscles: ['chest'],
          from: plan.date,
          until: plan.date,
          reason: 'pain',
          source: 'user',
          note: null,
        },
      ]);
    if (change === 'changed-load') plan.exercises[0]!.target += 1;
    await expect(
      startExtraSession(change === 'empty' ? [] : ['push'], plan),
    ).rejects.toBeInstanceOf(ExtraSessionChangedError);
    expect(startExtraWorkout).not.toHaveBeenCalled();
  },
);
it('passes database failures back without creating another session', async () => {
  const plan = await preview();
  jest.mocked(startExtraWorkout).mockRejectedValue(new Error('disk full'));
  await expect(startExtraSession(['push'], plan)).rejects.toThrow('disk full');
  expect(startExtraWorkout).toHaveBeenCalledTimes(1);
});
