import { createProposalController, ProposalChangedError, type ProposalDeps } from '../proposals';
import { CHAT_TOOLS } from '@/ai/contract/chatTools';
import { executeTool } from '@/ai/tools/execute';
import { planCustom } from '@/domain/plan/extra';
import { ExtraSessionChangedError } from '@/features/extra/actions';
import { proposalSnapshot, restIntent } from './proposalFixtures';

jest.mock('@/db/repositories/plannerSource', () => ({}));
jest.mock('@/db/repositories/profile', () => ({ getDayBoundaryHour: jest.fn() }));
jest.mock('@/db/repositories/weekPlan', () => ({ saveCoachWeek: jest.fn() }));
jest.mock('@/db/repositories/trainingBlocks', () => ({}));
jest.mock('@/db/repositories/workouts', () => ({ findInProgressWorkout: jest.fn() }));
jest.mock('@/features/extra/actions', () => ({
  ...jest.requireActual('@/features/extra/actions'),
  startExtraSession: jest.fn(),
}));

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
    [],
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
it('reports a changed extra recipe at start as stale, and a failed write as a failure', async () => {
  const { controller, deps } = setup(true);
  controller.beginTurn('Chcę dodatkowy trening klatki.');
  await controller.tools.proposeExtra!({ focusMuscles: ['chest'] });
  jest.mocked(deps.start).mockRejectedValueOnce(new Error('disk full'));
  await expect(controller.apply('proposal-1')).rejects.toThrow('disk full');
  jest.mocked(deps.start).mockRejectedValueOnce(new ExtraSessionChangedError());
  await expect(controller.apply('proposal-1')).rejects.toBeInstanceOf(ProposalChangedError);
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

describe('composing days with the coach (ADR 0006)', () => {
  const composeIntent = (slots: { slotId: string; sets?: number }[], daysAhead = 2) => ({
    days: [{ daysAhead, slots }],
    note: 'Górna partia jutro.',
  });

  it('lists the engine options of a day, with the reason for what is not possible', async () => {
    const { controller, s } = setup();
    s.input.constraints = [
      {
        id: 'sore',
        kind: 'avoid_muscle',
        muscles: ['chest'],
        from: '2026-10-09',
        until: '2026-10-09',
        reason: 'pain',
        source: 'user',
        note: null,
      },
    ];
    const out = await controller.tools.dayOptions!({ daysAhead: 1 });
    expect(CHAT_TOOLS.getDayOptions.output.safeParse(out).success).toBe(true);
    if ('error' in out) throw new Error(out.error);
    expect(out.date).toBe('2026-10-09');
    expect(out.options.find((o) => o.slotId === 'push')).toMatchObject({
      available: false,
      reason: 'AVOIDED_BY_REQUEST',
    });
    // Today's planned session works the back: tomorrow it is still recovering.
    expect(out.options.find((o) => o.slotId === 'pull')).toMatchObject({
      available: false,
      reason: 'RECOVERING',
    });
    const later = await controller.tools.dayOptions!({ daysAhead: 2 });
    if ('error' in later) throw new Error(later.error);
    expect(later.options.find((o) => o.slotId === 'pull')).toMatchObject({
      available: true,
      sets: 2,
    });
    expect(JSON.stringify(out)).not.toMatch(/"load"|"kg"|"target"/);
  });

  it('previews a composed day with its conflicts, and applies it once, replacing an older one', async () => {
    const { controller, deps, s } = setup();
    s.input.constraints = [
      {
        id: 'older',
        kind: 'compose_day',
        muscles: [],
        from: '2026-10-10',
        until: '2026-10-10',
        reason: 'other',
        source: 'coach',
        note: 'wcześniej',
        items: [{ slotId: 'legs', sets: 2 }],
      },
    ];
    const out = await controller.tools.proposeDay!(
      composeIntent([{ slotId: 'pull', sets: 1 }, { slotId: 'push' }]),
    );
    expect(CHAT_TOOLS.proposeDayPlan.output.safeParse(out).success).toBe(true);
    if ('error' in out) throw new Error(out.error);
    expect(out).toMatchObject({ proposalId: 'proposal-1', kind: 'compose' });
    expect(out.days).toEqual([{ date: '2026-10-10', applied: true, conflicts: [] }]);
    const after = out.changes.find((c) => c.after.date === '2026-10-10')!.after;
    expect(after.composed).toBe(true);
    expect(after.exercises.map((e) => [e.exercise.id, e.sets])).toEqual(
      expect.arrayContaining([
        ['pull', 1],
        ['push', 2],
      ]),
    );
    expect(deps.save).not.toHaveBeenCalled();
    await controller.apply('proposal-1');
    expect(deps.save).toHaveBeenCalledWith(
      'proposal-1',
      [
        expect.objectContaining({
          kind: 'compose_day',
          from: '2026-10-10',
          items: [
            { slotId: 'pull', sets: 1 },
            { slotId: 'push', sets: 2 },
          ],
        }),
      ],
      expect.objectContaining({ trigger: 'coach' }),
      expect.anything(),
      expect.anything(),
      '2026-10-08',
      expect.any(Date),
      ['older'],
    );
    await expect(controller.apply('proposal-1')).rejects.toBeInstanceOf(ProposalChangedError);
  });

  it('gives no card when the engine can take nothing, and says why', async () => {
    const { controller, s } = setup();
    s.input.week = { restWeekdays: [5] }; // 2026-10-10 is a Saturday
    const out = await controller.tools.proposeDay!(composeIntent([{ slotId: 'pull' }]));
    if ('error' in out) throw new Error(out.error);
    expect(out.proposalId).toBeNull();
    expect(out.days[0]).toEqual({
      date: '2026-10-10',
      applied: false,
      conflicts: [{ movement: 'Plecy', reason: 'REST_DAY' }],
    });
    expect(controller.resolve('proposal-1')).toBeNull();
  });

  it.each([
    ['an unknown movement', composeIntent([{ slotId: 'nope' }]), 'invalid_input'],
    ['a filler movement', composeIntent([{ slotId: 'mobility' }]), 'invalid_input'],
    [
      'the same day twice',
      {
        days: [
          { daysAhead: 1, slots: [{ slotId: 'pull' }] },
          { daysAhead: 1, slots: [{ slotId: 'push' }] },
        ],
        note: 'x',
      },
      'invalid_input',
    ],
    [
      'a load in the note',
      { ...composeIntent([{ slotId: 'pull' }]), note: 'Weź 10 kg' },
      'invalid_input',
    ],
  ])('refuses %s before reading options', async (_, intent, error) => {
    const { controller, deps } = setup();
    expect(await controller.tools.proposeDay!(intent)).toEqual({ error });
    expect(deps.save).not.toHaveBeenCalled();
  });

  it('asks about soreness of unknown strength, and closes a trained day', async () => {
    const sore = setup();
    sore.controller.beginTurn('Mam zakwasy nóg, ułóż mi jutro górę.');
    expect(await sore.controller.tools.proposeDay!(composeIntent([{ slotId: 'pull' }]))).toEqual({
      error: 'clarification_required',
    });
    const done = setup(true);
    expect(await done.controller.tools.proposeDay!(composeIntent([{ slotId: 'pull' }], 0))).toEqual(
      {
        error: 'day_done',
      },
    );
    expect(await done.controller.tools.dayOptions!({ daysAhead: 0 })).toEqual({
      error: 'day_done',
    });
  });

  it('does not compose while a session runs or after the day changed', async () => {
    const active = setup();
    jest.mocked(active.deps.inProgress).mockResolvedValue({ id: 'active' } as never);
    expect(await active.controller.tools.proposeDay!(composeIntent([{ slotId: 'pull' }]))).toEqual({
      error: 'in_progress',
    });
    const moved = setup();
    moved.controller.beginTurn('Ułóż jutro górę.', '2026-10-07');
    expect(await moved.controller.tools.dayOptions!({ daysAhead: 1 })).toEqual({
      error: 'date_changed',
    });
  });
});
