import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { slotByExercise } from '../plan/eligibility';
import type { PlannedExercise } from '../plan/types';
import { lastLoadsOf, validatePlan, type ValidationContext } from '../plan/validatePlan';
import type { HistorySet } from '../progression/history';
import type { MuscleGroup, PlannedLoad } from '../types';
import { byId, exercise, HARD_ONLY, slot } from './fixtures';

const db = (kg: number): PlannedLoad => ({ kind: 'dumbbell', mode: 'paired', kg });

const press = exercise({
  id: 'press',
  equipment: ['dumbbell'],
  dumbbellMode: 'paired',
  primaryMuscles: ['quads'],
  secondaryMuscles: ['core'],
});
const thrust = exercise({
  id: 'thrust',
  equipment: ['dumbbell'],
  dumbbellMode: 'paired',
  primaryMuscles: ['glutes'],
});
const plank = exercise({ id: 'plank', forceProfile: 'Isometric', primaryMuscles: ['core'] });
const catCow = exercise({ id: 'cat-cow', movementPattern: 'Mobility', primaryMuscles: ['quads'] });
const lateral = exercise({ id: 'lateral', loadsKnee: true, planesOfMotion: ['Frontal'] });
const old = exercise({ id: 'old', archived: true });
const lonely = exercise({ id: 'lonely', equipment: ['dumbbell'], dumbbellMode: 'paired' });
const catalog = byId([press, thrust, plank, catCow, lateral, old, lonely]);
const slots = [
  slot({
    id: 'a',
    exerciseIds: ['press', 'lateral', 'old'],
    repRange: [8, 15],
    start: { paired: 4 },
  }),
  slot({ id: 'b', exerciseIds: ['thrust'], repRange: [8, 15], start: { paired: 4 } }),
  slot({ id: 'c', kind: 'core', exerciseIds: ['plank'], timeRange: [20, 60], start: {} }),
  slot({ id: 'm', kind: 'filler', exerciseIds: ['cat-cow'], start: {} }),
];

const zero = () =>
  Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>;

const ctx = (patch: Partial<ValidationContext> = {}): ValidationContext => ({
  catalog,
  eligibility: { profile: HARD_ONLY, excludedIds: new Set() },
  slotOf: slotByExercise(slots),
  volume: zero(),
  lastLoads: { press: { load: db(6), targetMet: false } },
  ...patch,
});

const planned = (patch: Partial<PlannedExercise> = {}): PlannedExercise => ({
  label: 'A1',
  exerciseId: 'press',
  sets: 2,
  repMin: 8,
  repMax: 15,
  targetRirMin: 2,
  targetRirMax: 3,
  restSec: 90,
  slotId: 'a',
  load: db(6),
  unit: 'reps',
  target: 10,
  warmupSet: false,
  reasons: [],
  confidence: 'high',
  ...patch,
});

describe('validatePlan — SPEC §8', () => {
  it('passes a sound plan through untouched', () => {
    const plan = [planned()];
    const out = validatePlan(plan, ctx());
    expect(out).toEqual({ exercises: plan, adjustments: [] });
  });

  it('1: removes an exercise that does not exist', () => {
    expect(validatePlan([planned({ exerciseId: 'ghost' })], ctx())).toEqual({
      exercises: [],
      adjustments: [{ exerciseId: 'ghost', code: 'UNKNOWN_EXERCISE' }],
    });
  });

  it('2: removes, never trims, what the knee filter or the person rules out', () => {
    expect(validatePlan([planned({ exerciseId: 'lateral' })], ctx()).adjustments).toEqual([
      { exerciseId: 'lateral', code: 'MEDICAL_EXCLUSION' },
    ]);
    const mine = ctx({ eligibility: { profile: HARD_ONLY, excludedIds: new Set(['press']) } });
    expect(validatePlan([planned()], mine)).toEqual({
      exercises: [],
      adjustments: [{ exerciseId: 'press', code: 'USER_EXCLUDED' }],
    });
    expect(validatePlan([planned({ exerciseId: 'old' })], ctx()).adjustments).toEqual([
      { exerciseId: 'old', code: 'EXERCISE_UNAVAILABLE' },
    ]);
  });

  it('3: snaps a load the equipment cannot make', () => {
    const out = validatePlan([planned({ load: db(7) })], ctx());
    expect(out.exercises[0]!.load).toEqual(db(6));
    expect(out.adjustments).toEqual([{ exerciseId: 'press', code: 'LOAD_NOT_AVAILABLE' }]);
    const band = validatePlan(
      [planned({ load: { kind: 'band', bandId: 'red', position: 1 } })],
      ctx({ lastLoads: {} }),
    );
    expect(band.exercises[0]!.load).toEqual(db(4));
  });

  it('6: clamps sets, reps, holds and RIR into range', () => {
    const out = validatePlan(
      [planned({ sets: 9, target: 40, repMin: 0, repMax: 50, targetRirMin: 7, targetRirMax: -1 })],
      ctx({ volume: { ...zero(), quads: -20 } }),
    );
    expect(out.exercises[0]).toMatchObject({
      sets: 6,
      target: 30,
      repMin: 1,
      repMax: 30,
      targetRirMin: 0,
      targetRirMax: 0,
    });
    expect(out.adjustments).toEqual([{ exerciseId: 'press', code: 'RANGE_CLAMPED' }]);

    const hold = validatePlan(
      [
        planned({
          exerciseId: 'plank',
          slotId: 'c',
          load: { kind: 'bodyweight' },
          unit: 'sec',
          sets: 1,
          target: 400,
          timeSec: 400,
          repMin: undefined,
          repMax: undefined,
        }),
      ],
      ctx(),
    );
    expect(hold.exercises[0]).toMatchObject({ target: 300, timeSec: 300 });
    expect(hold.adjustments).toEqual([{ exerciseId: 'plank', code: 'RANGE_CLAMPED' }]);
  });

  it('6: keeps repMin at or under repMax', () => {
    const out = validatePlan([planned({ repMin: 40, repMax: 20 })], ctx());
    expect(out.exercises[0]).toMatchObject({ repMin: 20, repMax: 20 });
  });

  it('4: allows one step up only after a met target', () => {
    const met = ctx({ lastLoads: { press: { load: db(6), targetMet: true } } });
    expect(validatePlan([planned({ load: db(8) })], met).adjustments).toEqual([]);
    const jump = validatePlan([planned({ load: db(10) })], met);
    expect(jump.exercises[0]!.load).toEqual(db(8));
    expect(jump.adjustments).toEqual([{ exerciseId: 'press', code: 'LOAD_JUMP_CLAMPED' }]);
    expect(validatePlan([planned({ load: db(8) })], ctx()).exercises[0]!.load).toEqual(db(6));
  });

  it('4: caps a never-done exercise, or an unplaceable history, at the start load', () => {
    expect(
      validatePlan([planned({ load: db(10) })], ctx({ lastLoads: {} })).exercises[0]!.load,
    ).toEqual(db(4));
    const odd = ctx({
      lastLoads: { press: { load: { kind: 'bodyweight' }, targetMet: true } },
    });
    expect(validatePlan([planned({ load: db(10) })], odd).exercises[0]!.load).toEqual(db(4));
    const top = ctx({ lastLoads: { press: { load: db(10), targetMet: true } } });
    expect(validatePlan([planned({ load: db(10) })], top).adjustments).toEqual([]);
  });

  it('4: plans an exercise without a slot from the lightest rung', () => {
    expect(
      validatePlan([planned({ exerciseId: 'lonely', load: db(8) })], ctx({ lastLoads: {} }))
        .exercises[0]!.load,
    ).toEqual(db(2));
  });

  it('5: trims sets past the weekly maximum of direct sets, then removes', () => {
    const almost = validatePlan([planned()], ctx({ volume: { ...zero(), quads: 5 } }));
    expect(almost.exercises[0]!.sets).toBe(1);
    expect(almost.adjustments).toEqual([{ exerciseId: 'press', code: 'VOLUME_TRIMMED' }]);
    expect(
      validatePlan([planned(), planned()], ctx({ volume: { ...zero(), quads: 3 } })).exercises.map(
        (e) => e.sets,
      ),
    ).toEqual([2, 1]);
    expect(validatePlan([planned()], ctx({ volume: { ...zero(), quads: 6 } })).exercises).toEqual(
      [],
    );
  });

  it('5: lets secondary muscles, light practice and mobility through', () => {
    expect(validatePlan([planned()], ctx({ volume: { ...zero(), core: 6 } })).adjustments).toEqual(
      [],
    );
    const full = ctx({ volume: { ...zero(), quads: 6 } });
    expect(validatePlan([planned({ targetRirMin: 5, targetRirMax: 5 })], full).adjustments).toEqual(
      [],
    );
    expect(
      validatePlan([planned({ exerciseId: 'cat-cow', load: { kind: 'bodyweight' } })], full)
        .adjustments,
    ).toEqual([]);
  });

  it('5: gives glutes their higher maximum', () => {
    const thrustPlan = planned({ exerciseId: 'thrust', slotId: 'b', load: db(4) });
    expect(
      validatePlan([thrustPlan], ctx({ volume: { ...zero(), glutes: 6 }, lastLoads: {} }))
        .exercises[0]!.sets,
    ).toBe(2);
  });

  it('7: drops exercises from the end until the session fits', () => {
    const long = Array.from({ length: 8 }, (_, i) =>
      planned({ label: `A${i + 1}`, target: 15, restSec: 120 }),
    );
    const out = validatePlan(long, ctx({ volume: { ...zero(), quads: -100 } }));
    expect(out.exercises.length).toBeLessThan(8);
    expect(out.adjustments.every((a) => a.code === 'TIME_TRIMMED')).toBe(true);
  });
});

describe('lastLoadsOf', () => {
  const set = (patch: Partial<HistorySet> = {}): HistorySet => ({
    exerciseId: 'press',
    isWarmup: false,
    reps: 15,
    timeSec: null,
    rir: 2,
    load: db(6),
    ...patch,
  });

  it('reads the last load and whether its target was met', () => {
    const sessions = [
      { date: '2026-10-01', sets: [set({ load: db(4) })] },
      { date: '2026-10-03', sets: [set(), set({ reps: 12 })] },
      {
        date: '2026-10-03',
        sets: [set({ exerciseId: 'plank', reps: null, timeSec: 60, load: { kind: 'bodyweight' } })],
      },
    ];
    expect(
      lastLoadsOf(
        ['press', 'plank', 'thrust', 'ghost', 'lonely'],
        sessions,
        catalog,
        slotByExercise(slots),
      ),
    ).toEqual({
      press: { load: db(6), targetMet: false },
      plank: { load: { kind: 'bodyweight' }, targetMet: true },
    });
  });

  it('never calls a target met without a slot to say what it is', () => {
    const sessions = [{ date: '2026-10-03', sets: [set({ exerciseId: 'lonely', reps: 30 })] }];
    expect(lastLoadsOf(['lonely'], sessions, catalog, slotByExercise(slots))).toEqual({
      lonely: { load: db(6), targetMet: false },
    });
  });
});
