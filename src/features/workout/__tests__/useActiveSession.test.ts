import { act, renderHook } from '@testing-library/react-native';

import type { SessionState } from '@/db/repositories/sessions';
import { compileInput, exposure, set, stamp } from '@/domain/__tests__/compileFixtures';
import { exercise } from '@/domain/__tests__/fixtures';
import { legalObservation } from '@/domain/__tests__/planFixtures';
import { kg } from '@/domain/__tests__/progressionFixtures';
import type { CommandResult } from '@/domain/commands/result';
import type { SetEntry } from '@/domain/observations/entry';
import type { SetDispositionStatus } from '@/domain/observations/types';
import { compileSession } from '@/domain/plan/compile';
import type { StoredResult } from '@/domain/session/progress';
import { pl } from '@/strings/pl';

import { rememberUndone } from '../undoneSet';
import { type ActiveSessionDeps, type LoggedEntry, useActiveSession } from '../useActiveSession';

const mockReplace = jest.fn();
// Stable, like expo-router's own: the session reloads when the router changes.
const mockRouter = { replace: mockReplace, push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid' }));
jest.mock('@/stores/restTimerStore', () => ({ useRestTimerStore: { getState: jest.fn() } }));
jest.mock('@/db/repositories/profile', () => ({}));
jest.mock('@/db/repositories/sessions', () => ({}));

const exerciseMap = {
  'ex-a': exercise({ id: 'ex-a', name: 'Przysiad' }),
  'ex-b': exercise({ id: 'ex-b', name: 'Wiosłowanie' }),
  'ex-c': exercise({ id: 'ex-c', name: 'Wyciskanie' }),
};

/** A superset of a (2 sets) and b (1 set), then a lone c (1 set): steps a1 b1 a2 c1. */
const plan = () =>
  stamp(
    compileSession(
      compileInput([
        exposure('a', { group: 'A', sets: [set({ restAfterSec: 90 }), set({ restAfterSec: 90 })] }),
        exposure('b', { group: 'A', sets: [set({ restAfterSec: 90 })] }),
        exposure('c', { sets: [set({ restAfterSec: 60 })] }),
      ]),
    ),
  );

const entry: SetEntry = {
  status: 'performed',
  amount: { value: { kind: 'reps', reps: 10 }, edited: false },
  resistance: { value: kg(4), edited: false },
  rir: { value: 2, edited: false },
};
const logged: LoggedEntry = {
  entry,
  channel: 'touch',
  shown: { amount: 'visible', resistance: 'visible', rir: 'visible' },
};

/** The database of one session: what the commands change and `readSession` reads back. */
function setup(
  options: { done?: number[]; skipped?: number[]; status?: 'in_progress' | 'completed' } = {},
) {
  const sessionPlan = plan();
  const setIds = sessionPlan.execution.steps.flatMap((s) =>
    s.kind === 'perform' ? [s.plannedSetId] : [],
  );
  let revision = 1;
  let clock = 0;
  const results = new Map<string, StoredResult>();
  const skipped = new Set<string>();
  const store = {
    plan: sessionPlan,
    setIds,
    results,
    skipped,
    state: null as SessionState | null,
  };
  const write = (plannedSetId: string, id: string) => {
    clock += 1;
    results.set(plannedSetId, {
      id,
      revision: 1,
      observation: legalObservation({
        id,
        plannedSetId,
        recordedAt: `2026-10-09T08:00:${String(clock).padStart(2, '0')}.000Z`,
      }),
    });
  };
  (options.done ?? []).forEach((i) => write(setIds[i]!, `obs-${i}`));
  (options.skipped ?? []).forEach((i) => skipped.add(setIds[i]!));

  const read = (): SessionState => {
    const states = new Map<string, SetDispositionStatus>();
    skipped.forEach((id) => states.set(id, 'skipped'));
    results.forEach((r, id) => states.set(id, r.observation.status));
    return {
      workout: {
        id: 'w',
        trainingDate: '2026-10-09',
        status: options.status ?? 'in_progress',
        startedAt: '2026-10-09T08:00:00.000Z',
        finishedAt: null,
        sessionRpe: null,
        notes: null,
        revision,
      },
      plan: sessionPlan,
      states,
      results: new Map(results),
    };
  };
  const committed = <T>(result: T): CommandResult<T> => ({
    kind: 'committed',
    result,
    sessionRevision: (revision += 1),
  });
  const deps: ActiveSessionDeps = {
    readSession: jest.fn(() => read()),
    getProfile: jest.fn().mockResolvedValue({ knee: null }),
    getExcludedExerciseIds: jest.fn().mockResolvedValue([]),
    setExerciseExcluded: jest.fn().mockResolvedValue(undefined),
    logSet: jest.fn((cmd) => {
      write(cmd.plannedSetId!, `obs-${cmd.commandId}`);
      return committed({ observationId: `obs-${cmd.commandId}` });
    }),
    skipSets: jest.fn((cmd) => {
      cmd.plannedSetIds.forEach((id) => skipped.add(id));
      return committed({ skipped: [...cmd.plannedSetIds] });
    }),
    reopenSets: jest.fn((cmd) => {
      cmd.plannedSetIds.forEach((id) => skipped.delete(id));
      return committed({ reopened: [...cmd.plannedSetIds] });
    }),
    undoSet: jest.fn((cmd) => {
      const [plannedSetId] = [...results].find(([, r]) => r.id === cmd.observationId)!;
      results.delete(plannedSetId);
      return committed({ observationId: cmd.observationId, plannedSetId });
    }),
    startRest: jest.fn().mockResolvedValue(undefined),
    extendRest: jest.fn().mockResolvedValue(undefined),
    stopRest: jest.fn().mockResolvedValue(undefined),
    restEndsAt: jest.fn(() => null),
    now: () => 1_000_000,
    newId: (() => {
      let n = 0;
      return () => `cmd-${(n += 1)}`;
    })(),
    alert: jest.fn(),
  };
  return { deps, store, bump: () => (revision += 1) };
}

async function open(deps: ActiveSessionDeps) {
  const view = await renderHook(() => useActiveSession('w', exerciseMap, deps));
  await act(async () => {});
  return view;
}

const SUMMARY = { pathname: '/workout/summary/[id]', params: { id: 'w', back: 'undo' } };

beforeEach(() => {
  mockReplace.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('opens a fresh session on the warm-up, then the first set', async () => {
  const { deps } = setup();
  const { result } = await open(deps);
  expect(result.current.phase).toBe('warmup');
  expect(result.current.title).toBe('Lekki dzień');
  expect(result.current.steps).toHaveLength(4);
  await act(async () => result.current.warmupDone());
  expect(result.current.phase).toBe('logging');
  expect(result.current.exercise?.id).toBe('ex-a');
  expect(result.current.supersetWith).toBe('Wiosłowanie');
});

it('rests between sets, shows the done card after a superset and finishes after the last', async () => {
  const { deps } = setup();
  const { result } = await open(deps);
  await act(async () => result.current.warmupDone());

  // The rounds of a superset interleave: a1, b1, a2, then the lone exercise.
  expect(result.current.steps.map((s) => [s.label, s.round])).toEqual([
    ['A1', 1],
    ['A2', 1],
    ['A1', 2],
    ['B1', 1],
  ]);

  await act(async () => result.current.saveSet(logged));
  expect(deps.logSet).toHaveBeenCalledWith(
    expect.objectContaining({ plannedSetId: expect.stringContaining('1'), sessionId: 'w' }),
  );
  expect(deps.startRest).toHaveBeenCalledWith(90, pl.workout.session.restNotificationBody);
  expect(result.current.phase).toBe('resting');
  expect(result.current.upcoming).toMatchObject({
    label: 'A2 · Wiosłowanie',
    note: pl.workout.session.supersetNext,
  });

  await act(async () => result.current.restDone());
  expect(result.current.currentStep?.label).toBe('A2');
  await act(async () => result.current.saveSet(logged));
  await act(async () => result.current.restDone());
  expect(result.current.previousResult?.plannedSetId).toBe(result.current.steps[0]!.set.id);
  expect(result.current.previousPlanned?.id).toBe(result.current.steps[0]!.set.id);
  await act(async () => result.current.saveSet(logged));
  // The superset is done: the card replaces the countdown.
  expect(result.current.phase).toBe('groupDone');
  expect(result.current.groupDone.map((g) => [g.name, g.sets.length])).toEqual([
    ['Przysiad', 2],
    ['Wiosłowanie', 1],
  ]);
  expect(result.current.upcoming?.label).toBe('B1 · Wyciskanie');

  await act(async () => result.current.restDone());
  await act(async () => result.current.saveSet(logged));
  expect(mockReplace).toHaveBeenCalledWith(SUMMARY);
});

it('starts the next set from the result of the one before it in the same exercise', async () => {
  const { deps } = setup({ done: [0, 1] });
  const { result } = await open(deps);
  expect(result.current.currentStep?.label).toBe('A1');
  expect(result.current.previousResult?.plannedSetId).toBe(result.current.steps[0]!.set.id);
  expect(result.current.previousPlanned?.id).toBe(result.current.steps[0]!.set.id);
});

it('goes straight to the next set when the plan asks for no rest', async () => {
  const { deps, store } = setup({ done: [] });
  store.plan.exposures[0]!.sets[0]!.restAfterSec = 0;
  const { result } = await open(deps);
  await act(async () => result.current.warmupDone());
  await act(async () => result.current.saveSet(logged));
  expect(deps.startRest).not.toHaveBeenCalled();
  expect(result.current).toMatchObject({ phase: 'logging', currentIndex: 1 });
});

it('keeps the step and says so when a set cannot be saved', async () => {
  const { deps } = setup();
  jest.mocked(deps.logSet).mockReturnValueOnce({
    kind: 'storage_error',
    retryable: true,
    commandId: 'cmd',
    detail: 'disk full',
  });
  const { result } = await open(deps);
  await act(async () => result.current.warmupDone());
  await act(async () => result.current.saveSet(logged));
  expect(deps.alert).toHaveBeenCalledWith(pl.workout.session.saveSetError);
  expect(result.current).toMatchObject({ phase: 'logging', currentIndex: 0, saving: false });
  expect(deps.startRest).not.toHaveBeenCalled();
});

it('reads the session again and sends a command once more when the session moved on under it', async () => {
  const { deps, bump } = setup();
  jest.mocked(deps.logSet).mockImplementationOnce(() => {
    bump();
    return { kind: 'conflict', code: 'SESSION_CHANGED', actualRevision: 2 };
  });
  const { result } = await open(deps);
  await act(async () => result.current.warmupDone());
  await act(async () => result.current.saveSet(logged));
  expect(deps.logSet).toHaveBeenCalledTimes(2);
  expect(jest.mocked(deps.logSet).mock.calls[1]![0].expectedSessionRevision).toBe(2);
  expect(result.current.phase).toBe('resting');
});

it('never saves a set that already has a result', async () => {
  const { deps } = setup({ done: [0] });
  const { result } = await open(deps);
  await act(async () => result.current.warmupDone());
  await act(async () => result.current.jump(0));
  await act(async () => result.current.saveSet(logged));
  expect(deps.logSet).not.toHaveBeenCalled();
});

it('resumes where the work ends, and goes to the summary when everything is done', async () => {
  const resumed = await open(setup({ done: [0] }).deps);
  expect(resumed.result.current).toMatchObject({ phase: 'logging', currentIndex: 1 });

  await open(setup({ done: [0, 1, 2, 3] }).deps);
  expect(mockReplace).toHaveBeenCalledWith(SUMMARY);
});

it('reports a session that is missing or already finished', async () => {
  const { deps } = setup();
  jest.mocked(deps.readSession).mockReturnValue(null);
  expect((await open(deps)).result.current.phase).toBe('notFound');
  expect((await open(setup({ status: 'completed' }).deps)).result.current.phase).toBe('notFound');
});

it('takes the last set back and opens its step with the recorded numbers', async () => {
  const { deps } = setup({ done: [0] });
  const { result } = await open(deps);
  await act(async () => result.current.undo());
  expect(deps.undoSet).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 'w', observationId: 'obs-0' }),
  );
  expect(result.current).toMatchObject({ phase: 'logging', currentIndex: 0 });
  expect(result.current.restored?.plannedSetId).toBe(result.current.steps[0]!.set.id);
  expect(result.current.unfinishedCount).toBe(4);
  expect(deps.stopRest).toHaveBeenCalled();
});

it('says so when a set cannot be taken back, and does nothing when there is none', async () => {
  const { deps } = setup({ done: [0] });
  jest.mocked(deps.undoSet).mockReturnValueOnce({
    kind: 'rejected',
    code: 'UNKNOWN_OBSERVATION',
    detail: 'gone',
  });
  const { result } = await open(deps);
  await act(async () => result.current.undo());
  expect(deps.alert).toHaveBeenCalledWith(pl.workout.session.undoError);

  const fresh = await open(setup().deps);
  await act(async () => fresh.result.current.undo());
  expect(fresh.result.current.phase).toBe('warmup');
});

it('takes back the set it was asked to, and says so when another one is last by then', async () => {
  const { deps } = setup({ done: [0, 1] });
  const { result } = await open(deps);
  const first = result.current.steps[0]!.set.id;
  await act(async () => result.current.undo(first));
  expect(deps.undoSet).not.toHaveBeenCalled();
  expect(deps.alert).toHaveBeenCalledWith(pl.workout.session.undoStale);
  await act(async () => result.current.undo(result.current.steps[1]!.set.id));
  expect(deps.undoSet).toHaveBeenCalledWith(expect.objectContaining({ observationId: 'obs-1' }));
});

it('opens on the set that was taken back on the summary screen', async () => {
  const { deps, store } = setup({ done: [0, 1, 2] });
  const stored = store.results.get(store.setIds[2]!)!;
  store.results.delete(store.setIds[2]!);
  rememberUndone('w', { plannedSetId: store.setIds[2]!, result: stored.observation });
  const { result } = await open(deps);
  expect(result.current).toMatchObject({ phase: 'logging', currentIndex: 2 });
  expect(result.current.restored?.plannedSetId).toBe(store.setIds[2]);
});

it('excludes an exercise at once and reports a failed save', async () => {
  const { deps } = setup();
  jest.mocked(deps.setExerciseExcluded).mockRejectedValueOnce(new Error('locked'));
  const { result } = await open(deps);
  await act(async () => result.current.exclude(exerciseMap['ex-b']));
  expect(result.current.excludedIds.has('ex-b')).toBe(true);
  expect(deps.alert).toHaveBeenCalledWith(pl.common.error);
});

it('reads the plan again after a change and opens on what is next', async () => {
  const { deps } = setup({ done: [0] });
  const { result } = await open(deps);
  await act(async () => result.current.jump(3));
  await act(async () => result.current.planChanged());
  expect(deps.stopRest).toHaveBeenCalled();
  expect(result.current).toMatchObject({ phase: 'logging', currentIndex: 1 });

  jest.mocked(deps.readSession).mockReturnValue(null);
  await act(async () => result.current.planChanged());
  expect(result.current.phase).toBe('notFound');
});

it('finishes early, back to the summary that returns to the session', async () => {
  const { deps } = setup();
  const { result } = await open(deps);
  await act(async () => result.current.finish('resume'));
  expect(deps.stopRest).toHaveBeenCalled();
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/workout/summary/[id]',
    params: { id: 'w', back: 'resume' },
  });
});

describe('voice actions', () => {
  it('skips the exercise on screen for good, and finishes when only skipped sets are left', async () => {
    const { deps, store } = setup();
    const { result } = await open(deps);
    await act(async () => result.current.warmupDone());

    let outcome: ReturnType<typeof result.current.skipExercise> | undefined;
    await act(async () => {
      outcome = result.current.skipExercise();
    });
    expect(outcome).toEqual({
      kind: 'skipped',
      exposureIndex: 0,
      name: 'Przysiad',
      plannedSetIds: [store.setIds[0], store.setIds[2]],
    });
    expect(deps.skipSets).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'user_skipped',
        plannedSetIds: outcome && 'plannedSetIds' in outcome ? outcome.plannedSetIds : [],
      }),
    );
    expect(result.current.phase).toBe('logging');
    expect(result.current.currentStep?.label).toBe('A2');

    await act(async () => result.current.saveSet(logged));
    await act(async () => result.current.restDone());
    await act(async () => result.current.saveSet(logged));
    expect(mockReplace).toHaveBeenCalledWith(SUMMARY);
  });

  it('during a rest skips the exercise coming up', async () => {
    const { deps } = setup();
    const { result } = await open(deps);
    await act(async () => result.current.warmupDone());
    await act(async () => result.current.saveSet(logged));
    expect(result.current.upcoming?.label).toBe('A2 · Wiosłowanie');

    await act(async () => {
      result.current.skipExercise();
    });
    expect(deps.stopRest).toHaveBeenCalled();
    expect(result.current.phase).toBe('logging');
    expect(result.current.currentStep?.label).toBe('A1');
    expect(result.current.currentStep?.round).toBe(2);
  });

  it('does not skip the last thing left, and does nothing outside a set or rest', async () => {
    const { deps } = setup({ done: [0, 1, 2] });
    const { result } = await open(deps);
    expect(result.current.currentStep?.label).toBe('B1');
    let outcome: ReturnType<typeof result.current.skipExercise> | undefined;
    await act(async () => {
      outcome = result.current.skipExercise();
    });
    expect(outcome).toEqual({ kind: 'last' });
    expect(deps.skipSets).not.toHaveBeenCalled();

    const fresh = await open(setup().deps);
    expect(fresh.result.current.phase).toBe('warmup');
    expect(fresh.result.current.skipExercise()).toEqual({ kind: 'none' });
  });

  it('says so when the skip cannot be saved', async () => {
    const { deps } = setup();
    jest.mocked(deps.skipSets).mockReturnValueOnce({
      kind: 'rejected',
      code: 'SESSION_NOT_ACTIVE',
      detail: 'closed',
    });
    const { result } = await open(deps);
    await act(async () => result.current.warmupDone());
    expect(result.current.skipExercise()).toEqual({ kind: 'none' });
    expect(deps.alert).toHaveBeenCalledWith(pl.common.error);
    expect(result.current.currentIndex).toBe(0);
  });

  it('takes a skip back, and a jump onto a skipped exercise takes it back too', async () => {
    const { deps, store } = setup();
    const { result } = await open(deps);
    await act(async () => result.current.warmupDone());
    let outcome: ReturnType<typeof result.current.skipExercise> = { kind: 'none' };
    await act(async () => {
      outcome = result.current.skipExercise();
    });
    expect(store.skipped.size).toBe(2);
    await act(async () => {
      if (outcome.kind === 'skipped') result.current.unskip(outcome);
    });
    expect(store.skipped.size).toBe(0);
    expect(result.current.currentStep?.label).toBe('A1');
    expect(result.current.phase).toBe('logging');

    await act(async () => {
      result.current.skipExercise();
    });
    expect(store.skipped.size).toBe(2);
    await act(async () => result.current.jump(2));
    expect(store.skipped.size).toBe(0);
    expect(result.current.currentStep?.round).toBe(2);
  });

  it('says so when a skip cannot be taken back', async () => {
    const { deps } = setup();
    jest.mocked(deps.reopenSets).mockReturnValueOnce({
      kind: 'rejected',
      code: 'SESSION_NOT_ACTIVE',
      detail: 'closed',
    });
    const { result } = await open(deps);
    await act(async () => {
      result.current.unskip({ kind: 'skipped', exposureIndex: 0, name: 'x', plannedSetIds: ['x'] });
    });
    expect(deps.alert).toHaveBeenCalledWith(pl.common.error);
  });

  it('ends a rest early and puts it back with the time it had left', async () => {
    const { deps } = setup();
    (deps.restEndsAt as jest.Mock).mockReturnValue(1_040_000);
    const { result } = await open(deps);
    await act(async () => result.current.warmupDone());
    await act(async () => result.current.saveSet(logged));

    let ended: ReturnType<typeof result.current.endRest> = null;
    await act(async () => {
      ended = result.current.endRest();
    });
    expect(ended).toEqual({ phase: 'resting', index: 0, remainingMs: 40_000 });
    expect(result.current.phase).toBe('logging');
    expect(result.current.currentStep?.label).toBe('A2');

    (deps.startRest as jest.Mock).mockClear();
    await act(async () => result.current.resumeRest(ended!));
    expect(deps.startRest).toHaveBeenCalledWith(40, pl.workout.session.restNotificationBody);
    expect(result.current.phase).toBe('resting');
    expect(result.current.currentIndex).toBe(0);
  });

  it('a rest that had run out comes back as the next set; the done card comes back as itself', async () => {
    const { deps } = setup();
    const { result } = await open(deps);
    await act(async () => result.current.warmupDone());
    await act(async () =>
      result.current.resumeRest({ phase: 'resting', index: 0, remainingMs: 0 }),
    );
    expect(result.current.phase).toBe('logging');
    expect(result.current.currentIndex).toBe(0);
    await act(async () =>
      result.current.resumeRest({ phase: 'groupDone', index: 1, remainingMs: 0 }),
    );
    expect(result.current.phase).toBe('groupDone');
    let ended: ReturnType<typeof result.current.endRest> = null;
    await act(async () => {
      ended = result.current.endRest();
    });
    expect(ended).toEqual({ phase: 'groupDone', index: 1, remainingMs: 0 });
  });

  it('extends only a running rest', async () => {
    const { deps } = setup();
    const { result } = await open(deps);
    await act(async () => result.current.warmupDone());
    expect(result.current.extendRest(30)).toBe(false);
    expect(result.current.endRest()).toBeNull();
    await act(async () => result.current.saveSet(logged));
    expect(result.current.extendRest(30)).toBe(true);
    expect(deps.extendRest).toHaveBeenCalledWith(30, pl.workout.session.restNotificationBody);
  });

  it('goes back to the warm-up that was ended', async () => {
    const { deps } = setup();
    const { result } = await open(deps);
    await act(async () => result.current.warmupDone());
    await act(async () => result.current.backToWarmup());
    expect(result.current.phase).toBe('warmup');
  });
});
