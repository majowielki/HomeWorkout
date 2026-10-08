import { createProposalController, ProposalChangedError, type ProposalDeps } from '../proposals';
import { CHAT_TOOLS } from '@/ai/contract/chatTools';
import { executeTool } from '@/ai/tools/execute';
import { planCustom } from '@/domain/plan/extra';
import { proposalSnapshot, restIntent } from './proposalFixtures';

jest.mock('@/db/repositories/plannerSource', () => ({}));
jest.mock('@/db/repositories/profile', () => ({ getDayBoundaryHour: jest.fn() }));
jest.mock('@/db/repositories/weekPlan', () => ({ saveCoachWeek: jest.fn() }));
jest.mock('@/db/repositories/trainingBlocks', () => ({}));
jest.mock('@/db/repositories/workouts', () => ({ findInProgressWorkout: jest.fn() }));
jest.mock('@/features/extra/actions', () => ({ startExtraSession: jest.fn() }));

function setup(done = false) {
  const s = proposalSnapshot(done);
  const deps: ProposalDeps = {
    snapshot: jest.fn().mockResolvedValue(s),
    inProgress: jest.fn().mockResolvedValue(null),
    boundary: jest.fn().mockResolvedValue(3),
    save: jest.fn().mockResolvedValue(undefined),
    start: jest.fn().mockResolvedValue('workout-extra'),
    id: () => 'proposal-1',
    now: () => new Date(2026, 9, 8, 12),
    lock: (task) => task(),
  };
  const controller = createProposalController(deps);
  controller.beginTurn('Jutro mam dzień wolny, zmień plan.');
  return { s, deps, controller };
}

it('previews through the real engine with no writes and applies the reviewed constraints once', async () => {
  const { controller, deps } = setup();
  const out = await controller.tools.proposeChange!(restIntent);
  expect(CHAT_TOOLS.proposePlanChange.output.safeParse(out).success).toBe(true);
  expect(out).toMatchObject({
    requiresAcceptance: true,
    changes: expect.arrayContaining([
      expect.objectContaining({
        after: expect.objectContaining({ date: '2026-10-09', rest: true }),
      }),
    ]),
  });
  expect(deps.save).not.toHaveBeenCalled();
  expect(deps.start).not.toHaveBeenCalled();
  expect(controller.resolve('proposal-1')).toBeTruthy();
  await controller.apply('proposal-1');
  expect(deps.save).toHaveBeenCalledWith(
    'proposal-1',
    expect.arrayContaining([
      expect.objectContaining({ source: 'coach', from: '2026-10-09', until: '2026-10-09' }),
    ]),
    expect.objectContaining({ trigger: 'coach' }),
    expect.anything(),
    expect.anything(),
    '2026-10-08',
    expect.any(Date),
  );
  await expect(controller.apply('proposal-1')).rejects.toBeInstanceOf(ProposalChangedError);
  expect(deps.save).toHaveBeenCalledTimes(1);
});
it.each(['reject', 'new-question', 'clock', 'history', 'constraint', 'active'])(
  'does not apply an obsolete or rejected proposal: %s',
  async (change) => {
    const { controller, deps, s } = setup();
    await controller.tools.proposeChange!(restIntent);
    if (change === 'reject') controller.reject('proposal-1');
    if (change === 'new-question') controller.beginTurn('Dlaczego taki plan?');
    if (change === 'clock') deps.now = () => new Date(2026, 9, 9, 12);
    if (change === 'history') s.source.sessions.push({ date: '2026-10-08', sets: [] });
    if (change === 'constraint')
      s.input.constraints = [
        {
          id: 'new',
          kind: 'rest_day',
          muscles: [],
          from: '2026-10-08',
          until: '2026-10-08',
          source: 'user',
          reason: 'busy',
          note: null,
        },
      ];
    if (change === 'active')
      jest.mocked(deps.inProgress).mockResolvedValue({ id: 'active' } as never);
    await expect(controller.apply('proposal-1')).rejects.toBeInstanceOf(ProposalChangedError);
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.start).not.toHaveBeenCalled();
  },
);
it('keeps a failed atomic write available for retry and prevents a double tap during it', async () => {
  const { controller, deps } = setup();
  await controller.tools.proposeChange!(restIntent);
  jest.mocked(deps.save).mockRejectedValueOnce(new Error('disk full'));
  await expect(controller.apply('proposal-1')).rejects.toThrow('disk full');
  let finish!: () => void;
  jest.mocked(deps.save).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const running = controller.apply('proposal-1');
  await expect(controller.apply('proposal-1')).rejects.toBeInstanceOf(ProposalChangedError);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  finish();
  await running;
  expect(deps.save).toHaveBeenCalledTimes(2);
});
it.each([
  'medical',
  'note-medical',
  'note-load',
  'scope',
  'range',
  'missing-muscles',
  'rest-muscles',
])('refuses invalid proposal intents before reading or writing: %s', async (kind) => {
  const { controller, deps } = setup();
  const intent = structuredClone(restIntent) as Parameters<
    NonNullable<typeof controller.tools.proposeChange>
  >[0];
  if (kind === 'medical') controller.beginTurn('Boli mnie kolano. Zmień plan.');
  if (kind === 'note-medical') intent.note = 'Boli kolano.';
  if (kind === 'note-load') intent.note = 'Weź 10 kg w następnej sesji.';
  if (kind === 'scope') intent.note = 'Zwiększ dawkę Mounjaro.';
  if (kind === 'range') {
    intent.constraints[0]!.fromDaysAhead = 6;
    intent.constraints[0]!.days = 3;
  }
  if (kind === 'missing-muscles') intent.constraints[0]!.kind = 'avoid_muscle';
  if (kind === 'rest-muscles') intent.constraints[0]!.muscles = ['chest'];
  expect(await controller.tools.proposeChange!(intent)).toEqual({ error: 'invalid_input' });
  expect(deps.snapshot).not.toHaveBeenCalled();
  expect(deps.save).not.toHaveBeenCalled();
});
it.each([
  'Mam lekkie zakwasy nóg, zmień plan.',
  'Mam zakwasy nóg, zmień plan.',
  'Mam zakwasy nóg 2/5, zmień plan.',
  'Mam silny ból mięśni 4/5. Zmień plan.',
  'Mam silny ból mięśni 4/5, to nie zakwasy. Zmień plan.',
])('does not let the model invent severe DOMS: %s', async (question) => {
  const { controller, deps } = setup();
  controller.beginTurn(question);
  const intent = {
    constraints: [
      {
        kind: 'avoid_muscle' as const,
        muscles: ['quads' as const],
        fromDaysAhead: 0,
        days: 2,
        reason: 'doms' as const,
        domsLevel: 4,
      },
    ],
    note: 'Prośba o pominięcie nóg.',
  };
  expect(await controller.tools.proposeChange!(intent)).toEqual({
    error: 'clarification_required',
  });
  expect(
    await controller.tools.proposeChange!({
      ...intent,
      constraints: [{ ...intent.constraints[0]!, reason: 'other' }],
    }),
  ).toEqual({ error: 'clarification_required' });
  expect(deps.save).not.toHaveBeenCalled();
});
it('previews strong DOMS constraints without changing a completed day', async () => {
  const { controller, deps } = setup(true);
  controller.beginTurn('Mam silne zakwasy nóg 4/5. Pomiń nogi na 2 dni.');
  const out = await controller.tools.proposeChange!({
    constraints: [
      {
        kind: 'avoid_muscle',
        muscles: ['quads', 'glutes'],
        fromDaysAhead: 0,
        days: 2,
        reason: 'doms',
        domsLevel: 4,
      },
    ],
    note: 'Silne zakwasy nóg.',
  });
  expect(out).toMatchObject({
    constraints: [expect.objectContaining({ from: '2026-10-08', until: '2026-10-09' })],
  });
  if ('changes' in out) expect(out.changes.every((d) => d.after.date > '2026-10-08')).toBe(true);
  expect(deps.save).not.toHaveBeenCalled();
});
it('reads a seven-day week without a write and marks an active day locked', async () => {
  const { controller, deps, s } = setup();
  const day = planCustom({ ...s.input, block: s.advance.block }, ['push']);
  jest
    .mocked(deps.inProgress)
    .mockResolvedValue({ id: 'active', trainingDate: s.input.asOf, plan: day } as never);
  const out = await controller.tools.week!();
  expect(out).toMatchObject({
    asOf: '2026-10-08',
    days: [
      expect.objectContaining({
        status: 'in_progress',
        exercises: [expect.objectContaining({ exercise: expect.objectContaining({ id: 'push' }) })],
      }),
      ...Array.from({ length: 6 }, () => expect.anything()),
    ],
  });
  expect(await controller.tools.proposeChange!(restIntent)).toEqual({ error: 'in_progress' });
  expect(deps.save).not.toHaveBeenCalled();
});
it('previews an extra session and starts only after applying', async () => {
  const { controller, deps } = setup(true);
  controller.beginTurn('Chcę dodatkowy trening klatki.');
  const out = await controller.tools.proposeExtra!({ focusMuscles: ['chest'] });
  expect(CHAT_TOOLS.proposeExtraSession.output.safeParse(out).success).toBe(true);
  expect(JSON.stringify(out)).not.toMatch(/"load"|"kg"|"target"/);
  expect(deps.start).not.toHaveBeenCalled();
  expect(await controller.apply('proposal-1')).toEqual({ workoutId: 'workout-extra' });
  expect(deps.start).toHaveBeenCalledWith(['push'], expect.objectContaining({ kind: 'extra' }), {
    proposalId: 'proposal-1',
  });
  expect(deps.save).not.toHaveBeenCalled();
});
it.each(['not-done', 'rest', 'active', 'medical', 'no-room'])(
  'offers no extra session when unavailable: %s',
  async (kind) => {
    const { controller, deps, s } = setup(kind !== 'not-done');
    if (kind === 'rest') s.input.week = { restWeekdays: [3] };
    if (kind === 'active')
      jest.mocked(deps.inProgress).mockResolvedValue({ id: 'active' } as never);
    if (kind === 'medical') controller.beginTurn('Boli kolano, daj dodatkowy trening.');
    if (kind === 'no-room')
      s.input.constraints = [
        {
          id: 'r',
          kind: 'avoid_muscle',
          muscles: ['chest'],
          from: '2026-10-08',
          until: '2026-10-08',
          reason: 'pain',
          source: 'user',
          note: null,
        },
      ];
    expect(await controller.tools.proposeExtra!({ focusMuscles: ['chest'] })).toEqual({
      error: {
        'not-done': 'finish_first',
        rest: 'rest_day',
        active: 'in_progress',
        medical: 'invalid_input',
        'no-room': 'no_plan',
      }[kind],
    });
    expect(deps.start).not.toHaveBeenCalled();
  },
);
it('runs a planning tool through the protocol funnel and refuses a model load field', async () => {
  const { controller } = setup();
  const env = { load: jest.fn(), plan: jest.fn(), ...controller.tools };
  expect(
    (await executeTool({ id: 'p', name: 'proposePlanChange', input: restIntent }, env)).output,
  ).toMatchObject({ requiresAcceptance: true });
  expect(
    (
      await executeTool(
        { id: 'p2', name: 'proposePlanChange', input: { ...restIntent, kg: 10 } },
        env,
      )
    ).output,
  ).toEqual({ error: 'invalid_input' });
});
it('does not reinterpret relative dates when the training day changes during a model call', async () => {
  const { controller, deps } = setup(true);
  controller.beginTurn('Jutro wolne.', '2026-10-07');
  expect(await controller.tools.proposeChange!(restIntent)).toEqual({ error: 'date_changed' });
  expect(await controller.tools.proposeExtra!({ focusMuscles: ['chest'] })).toEqual({
    error: 'date_changed',
  });
  expect(deps.save).not.toHaveBeenCalled();
  expect(deps.start).not.toHaveBeenCalled();
});
it.each([
  'Mam silne zakwasy nóg 4/5. Daj dodatkowy trening nóg.',
  'Mam zakwasy nóg. Daj dodatkowy trening.',
])('does not ignore soreness in an additional-work request: %s', async (question) => {
  const { controller, deps } = setup(true);
  controller.beginTurn(question);
  expect(await controller.tools.proposeExtra!({ focusMuscles: ['quads'] })).toEqual({
    error: 'clarification_required',
  });
  expect(deps.start).not.toHaveBeenCalled();
});
