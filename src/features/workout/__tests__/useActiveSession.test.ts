import { act, renderHook } from '@testing-library/react-native';

import { exercise } from '@/domain/__tests__/fixtures';
import { stepKey } from '@/domain/session/steps';
import type { TemplateBlock } from '@/domain/types';
import { pl } from '@/strings/pl';
import { type ActiveSessionDeps, useActiveSession } from '../useActiveSession';
import type { SavedSetData } from '../SetLogger';

const mockReplace = jest.fn();
// Stable, like expo-router's own: the session reloads when the router changes.
const mockRouter = { replace: mockReplace, push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/stores/restTimerStore', () => ({ useRestTimerStore: { getState: jest.fn() } }));
jest.mock('@/db/repositories/profile', () => ({}));
jest.mock('@/db/repositories/setLogs', () => ({}));
jest.mock('@/db/repositories/templates', () => ({}));
jest.mock('@/db/repositories/trainingBlocks', () => ({}));
jest.mock('@/db/repositories/workouts', () => ({}));

const block = (label: string, exerciseId: string, sets: number): TemplateBlock => ({
  label,
  exerciseId,
  sets,
  repMin: 8,
  repMax: 12,
  targetRirMin: 1,
  targetRirMax: 3,
  restSec: 90,
});
const exerciseMap = {
  squat: exercise({ id: 'squat', name: 'Przysiad' }),
  row: exercise({ id: 'row', name: 'Wiosłowanie' }),
  press: exercise({ id: 'press', name: 'Wyciskanie' }),
};
const data: SavedSetData = {
  reps: 10,
  timeSec: null,
  rir: 2,
  weightKg: 8,
  dumbbellMode: 'paired',
  bandId: null,
  anchorPosition: null,
  estimatedLoadKg: null,
} as SavedSetData;

/** A template session A1 (2 sets), B1 (1 set), and a database that remembers what was logged. */
function setup(logged: string[] = []) {
  const keys = new Set(logged);
  const rows: { exerciseOrder: number; setIndex: number; exerciseId: string }[] = [];
  const deps: ActiveSessionDeps = {
    getWorkout: jest.fn().mockResolvedValue({
      id: 'w',
      trainingDate: '2026-10-08',
      templateId: 'fbw-a',
      plan: null,
    } as never),
    getTemplate: jest.fn().mockResolvedValue({
      id: 'fbw-a',
      name: 'FBW A',
      blocks: [block('A1', 'squat', 2), block('B1', 'row', 1)],
    } as never),
    getProfile: jest.fn().mockResolvedValue(null),
    getExcludedExerciseIds: jest.fn().mockResolvedValue([]),
    setExerciseExcluded: jest.fn().mockResolvedValue(undefined),
    getLoggedStepKeys: jest.fn(async () => new Set(keys)),
    getSetsForWorkout: jest.fn(async () => rows as never),
    logSet: jest.fn(async (input) => {
      keys.add(stepKey(input.exerciseOrder, input.setIndex));
      rows.push(input);
      return 'set';
    }),
    takeBackLastSet: jest.fn(),
    getCurrentBlock: jest.fn().mockResolvedValue({ id: 'block', state: {} as never }),
    setBlockSelection: jest.fn().mockResolvedValue(undefined),
    startRest: jest.fn().mockResolvedValue(undefined),
    stopRest: jest.fn().mockResolvedValue(undefined),
    alert: jest.fn(),
  };
  return { deps, keys };
}

async function open(deps: ActiveSessionDeps) {
  const view = await renderHook(() => useActiveSession('w', exerciseMap, deps));
  await act(async () => {});
  return view;
}

beforeEach(() => mockReplace.mockClear());

it('opens a fresh session on the warm-up, then the first set', async () => {
  const { deps } = setup();
  const { result } = await open(deps);
  expect(result.current.phase).toBe('warmup');
  expect(result.current.loaded?.title).toBe('FBW A');
  expect(result.current.steps).toHaveLength(3);
  await act(async () => result.current.warmupDone());
  expect(result.current.phase).toBe('logging');
  expect(result.current.effectiveExercise?.id).toBe('squat');
});

it('rests between sets, shows the done card after an exercise and finishes after the last', async () => {
  const { deps } = setup();
  const { result } = await open(deps);
  await act(async () => result.current.warmupDone());

  // The steps interleave the exercises (never one twice in a row): A1, B1, A1.
  const order = result.current.steps.map((s) => [s.block.label, s.setNumber]);
  expect(order).toEqual([
    ['A1', 1],
    ['B1', 1],
    ['A1', 2],
  ]);

  await act(async () => result.current.saveSet(data));
  expect(deps.logSet).toHaveBeenCalledWith(
    expect.objectContaining({ exerciseId: 'squat', exerciseOrder: 0, setIndex: 1, reps: 10 }),
  );
  expect(deps.startRest).toHaveBeenCalledWith(90, pl.workout.session.restNotificationBody);
  expect(result.current.phase).toBe('resting');
  expect(result.current.upcoming?.label).toBe('B1 · Wiosłowanie');

  await act(async () => result.current.restDone());
  expect(result.current.currentStep?.block.label).toBe('B1');
  await act(async () => result.current.saveSet(data));
  // B1 has one set: the exercise is done, so the done card replaces the countdown.
  expect(result.current.phase).toBe('groupDone');
  expect(result.current.groupDone).toEqual([
    expect.objectContaining({ name: 'Wiosłowanie', sets: expect.any(Array) }),
  ]);
  expect(result.current.upcoming?.label).toBe('A1 · Przysiad');

  await act(async () => result.current.restDone());
  await act(async () => result.current.saveSet(data));
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/workout/summary/[id]',
    params: { id: 'w', back: 'undo' },
  });
});

it('keeps the step and says so when a set cannot be saved', async () => {
  const { deps } = setup();
  jest.mocked(deps.logSet).mockRejectedValueOnce(new Error('disk full'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const { result } = await open(deps);
  await act(async () => result.current.warmupDone());
  await act(async () => result.current.saveSet(data));
  expect(deps.alert).toHaveBeenCalledWith(pl.workout.session.saveSetError);
  expect(result.current).toMatchObject({ phase: 'logging', currentIndex: 0, saving: false });
  expect(deps.startRest).not.toHaveBeenCalled();
  warn.mockRestore();
});

it('never logs the same step twice', async () => {
  const { deps } = setup();
  const { result } = await open(deps);
  await act(async () => result.current.warmupDone());
  await act(async () => result.current.saveSet(data));
  await act(async () => result.current.jump(0));
  await act(async () => result.current.saveSet(data));
  expect(deps.logSet).toHaveBeenCalledTimes(1);
});

it('resumes where the log ends, and goes to the summary when everything is logged', async () => {
  const resumed = await open(setup([stepKey(0, 1)]).deps);
  expect(resumed.result.current).toMatchObject({ phase: 'logging', currentIndex: 1 });

  await open(setup([stepKey(0, 1), stepKey(0, 2), stepKey(1, 1)]).deps);
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/workout/summary/[id]',
    params: { id: 'w', back: 'undo' },
  });
});

it('reports a missing session', async () => {
  const { deps } = setup();
  jest.mocked(deps.getWorkout).mockResolvedValue(null);
  const { result } = await open(deps);
  expect(result.current.phase).toBe('notFound');
});

it('takes the last set back and opens its step with the logged numbers', async () => {
  const { deps, keys } = setup([stepKey(0, 1)]);
  jest.mocked(deps.takeBackLastSet).mockImplementation(async () => {
    keys.delete(stepKey(0, 1));
    return { exerciseOrder: 0, setIndex: 1, reps: 11, timeSec: null, rir: 1 } as never;
  });
  const { result } = await open(deps);
  await act(async () => result.current.undo());
  expect(result.current).toMatchObject({ phase: 'logging', currentIndex: 0 });
  expect(result.current.restored?.prefill).toMatchObject({ reps: 11, rir: 1 });
  expect(result.current.unloggedCount).toBe(3);
});

it('swaps for the block and says so when that cannot be saved; restoring undoes it', async () => {
  const { deps } = setup();
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const { result } = await open(deps);
  await act(async () => result.current.warmupDone());
  await act(async () =>
    result.current.substitute({
      exercise: exerciseMap.press,
      forBlock: true,
      slotId: 'squat-slot',
    }),
  );
  expect(result.current.effectiveExercise?.id).toBe('press');
  expect(deps.setBlockSelection).toHaveBeenCalledWith('block', 'squat-slot', 'press');

  jest.mocked(deps.setBlockSelection).mockRejectedValueOnce(new Error('locked'));
  await act(async () => result.current.restoreSubstitute());
  expect(result.current.effectiveExercise?.id).toBe('squat');
  expect(deps.setBlockSelection).toHaveBeenLastCalledWith('block', 'squat-slot', 'squat');
  expect(deps.alert).toHaveBeenCalledWith(pl.workout.session.blockSwapError);
  warn.mockRestore();
});

it('excludes an exercise at once and reports a failed save', async () => {
  const { deps } = setup();
  jest.mocked(deps.setExerciseExcluded).mockRejectedValueOnce(new Error('locked'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const { result } = await open(deps);
  await act(async () => result.current.exclude(exerciseMap.row));
  expect(result.current.excludedIds.has('row')).toBe(true);
  expect(deps.alert).toHaveBeenCalledWith(pl.common.error);
  warn.mockRestore();
});
