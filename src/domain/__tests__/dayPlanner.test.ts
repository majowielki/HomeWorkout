import { PLANNER_CONFIG } from '../config/training';
import { rotateSelections } from '../plan/block';
import { planDay, type PlannerInput } from '../plan/dayPlanner';
import type { EligibilityContext } from '../plan/eligibility';
import type { BlockState, DailyReadiness } from '../plan/types';
import type { HistorySession, HistorySet } from '../progression/history';
import { addDays } from '../time/trainingDate';
import type { PlannedLoad } from '../types';
import { byId, exercise, HARD_ONLY, slot } from './fixtures';

const ASOF = '2026-10-20';
const ago = (days: number) => addDays(ASOF, -days);
const db = (kg: number, mode: 'paired' | 'single' = 'paired'): PlannedLoad => ({
  kind: 'dumbbell',
  mode,
  kg,
});

const dumbbell = { equipment: ['dumbbell' as const], dumbbellMode: 'paired' as const };
const catalog = byId([
  exercise({ id: 'squat', ...dumbbell, primaryMuscles: ['quads', 'glutes'] }),
  exercise({
    id: 'split',
    ...dumbbell,
    movementPattern: 'Lunge',
    stanceMechanics: 'UnilateralSupported',
    primaryMuscles: ['quads', 'glutes'],
  }),
  // hamstrings: a muscle no block exercise trains, so only a swap brings it in
  exercise({ id: 'goblet', ...dumbbell, primaryMuscles: ['quads', 'glutes', 'hamstrings'] }),
  exercise({
    id: 'press',
    ...dumbbell,
    movementPattern: 'Push',
    primaryMuscles: ['chest', 'triceps'],
  }),
  exercise({
    id: 'row',
    equipment: ['band'],
    movementPattern: 'Pull',
    primaryMuscles: ['back', 'lats'],
  }),
  exercise({ id: 'curl', ...dumbbell, movementPattern: 'Isolation', primaryMuscles: ['biceps'] }),
  exercise({
    id: 'plank',
    movementPattern: 'Core',
    forceProfile: 'Isometric',
    primaryMuscles: ['core'],
  }),
  exercise({ id: 'deadbug', movementPattern: 'Core', primaryMuscles: ['core'] }),
  exercise({ id: 'catcow', movementPattern: 'Mobility', primaryMuscles: ['back'] }),
  exercise({ id: 'knee-bad', loadsKnee: true, planesOfMotion: ['Frontal'] }),
]);
const slots = [
  slot({ id: 'squat', exerciseIds: ['squat'], start: { paired: 6 } }),
  slot({ id: 'lunge', exerciseIds: ['split', 'goblet'], start: { paired: 2 } }),
  slot({ id: 'push', region: 'push', exerciseIds: ['press'], start: { paired: 4 } }),
  slot({ id: 'pull', region: 'pull', exerciseIds: ['row'], start: { band: 'red' } }),
  slot({
    id: 'curl',
    kind: 'accessory',
    region: 'arms',
    exerciseIds: ['curl'],
    start: { paired: 4 },
  }),
  slot({
    id: 'core',
    kind: 'core',
    region: 'core',
    exerciseIds: ['plank'],
    timeRange: [20, 60],
    lightFill: true,
  }),
  slot({
    id: 'core2',
    kind: 'core',
    region: 'core',
    exerciseIds: ['deadbug'],
    repRange: [8, 12],
    lightFill: true,
  }),
  slot({ id: 'nocand', kind: 'accessory', exerciseIds: ['knee-bad'] }),
  slot({
    id: 'mobility',
    kind: 'filler',
    region: 'mobility',
    exerciseIds: ['catcow'],
    repRange: [6, 10],
    rir: [4, 5],
  }),
];
const eligibility: EligibilityContext = { profile: HARD_ONLY, excludedIds: new Set() };
const block = (patch: Partial<BlockState> = {}): BlockState => ({
  index: 1,
  startedOn: ago(10),
  deloadFrom: null,
  deloadReason: null,
  selections: rotateSelections(null, slots, catalog, eligibility),
  ...patch,
});

const set = (exerciseId: string, patch: Partial<HistorySet> = {}): HistorySet => ({
  exerciseId,
  isWarmup: false,
  reps: 12,
  timeSec: null,
  rir: 2,
  load: db(6),
  ...patch,
});
const session = (daysAgo: number, sets: HistorySet[]): HistorySession => ({
  date: ago(daysAgo),
  sets,
});
const times = (n: number, s: HistorySet) => Array.from({ length: n }, () => s);

const input = (patch: Partial<PlannerInput> = {}): PlannerInput => ({
  asOf: ASOF,
  catalog,
  slots,
  eligibility,
  block: block(),
  sessions: [],
  rides: [],
  daily: [],
  ...patch,
});

const ids = (plan: ReturnType<typeof planDay>) => plan.exercises.map((e) => e.exerciseId);
const skip = (plan: ReturnType<typeof planDay>, slotId: string) =>
  plan.skipped.find((s) => s.slotId === slotId)?.reason;
const today = (patch: Partial<DailyReadiness>): DailyReadiness => ({
  date: ASOF,
  sleepHours: 7,
  energy: 3,
  soreness: null,
  ...patch,
});

describe('planDay — the first day', () => {
  const plan = planDay(input());

  it('fills the time budget with the muscles most in need, rare ones first', () => {
    expect(ids(plan)).toEqual(['squat', 'press', 'row', 'curl', 'plank']);
    expect(plan.estimatedMinutes).toBe(24);
  });

  it('pairs lower with upper body and labels the groups', () => {
    expect(plan.exercises.map((e) => e.label)).toEqual(['A1', 'A2', 'B1', 'C1', 'D1']);
    expect(plan.regions).toEqual(['lower', 'push', 'pull', 'arms', 'core']);
  });

  it('starts everything light, the band without a logged warm-up set (SPEC v1.3)', () => {
    expect(plan.exercises.every((e) => e.reasons.includes('FIRST_EXPOSURE'))).toBe(true);
    expect(plan.exercises.find((e) => e.exerciseId === 'row')).toMatchObject({
      warmupSet: false,
      load: { kind: 'band', bandId: 'red', position: 1 },
    });
    expect(plan.exercises[0]).toMatchObject({
      sets: 2,
      repMin: 10,
      repMax: 20,
      target: 10,
      load: db(6),
    });
  });

  it('says why each other slot is out', () => {
    expect(skip(plan, 'lunge')).toBe('ALREADY_TODAY');
    expect(skip(plan, 'core2')).toBe('ALREADY_TODAY');
    expect(skip(plan, 'nocand')).toBe('NO_CANDIDATE');
    expect(plan.skipped.find((s) => s.slotId === 'nocand')?.exerciseId).toBeNull();
  });

  it('describes the day', () => {
    expect(plan).toMatchObject({
      version: 1,
      date: ASOF,
      blockIndex: 1,
      phase: 'work',
      dayReasons: ['FIRST_DAY'],
      signals: [],
      adjustments: [],
      bike: { minutes: 10, resistance: null, reasons: ['FIRST_EXPOSURE'] },
    });
  });
});

describe('planDay — why a slot is out', () => {
  it('DOMS_HIGH: a muscle sore at 4 this morning', () => {
    const plan = planDay(input({ daily: [today({ soreness: { chest: 4 } })] }));
    expect(skip(plan, 'push')).toBe('DOMS_HIGH');
  });

  it('RECOVERING: worked as a primary yesterday — but not by light practice', () => {
    const sessions = [
      session(1, [set('squat'), set('plank', { rir: 5, reps: null, timeSec: 20 })]),
    ];
    const plan = planDay(input({ sessions }));
    expect(skip(plan, 'squat')).toBe('RECOVERING');
    expect(skip(plan, 'lunge')).toBe('RECOVERING');
    expect(ids(plan)).toContain('plank');
  });

  it('VOLUME_AT_MAX: six direct sets this week', () => {
    const plan = planDay(input({ sessions: [session(3, times(6, set('press')))] }));
    expect(skip(plan, 'push')).toBe('VOLUME_AT_MAX');
  });

  it('VOLUME_ON_TARGET: four sets this week and done recently', () => {
    const plan = planDay(input({ sessions: [session(3, times(4, set('curl')))] }));
    expect(skip(plan, 'curl')).toBe('VOLUME_ON_TARGET');
  });

  it('lets in a slot that waited 10+ days even when its muscles are on target', () => {
    const plan = planDay(input({ sessions: [session(3, times(4, set('squat')))] }));
    expect(ids(plan)).toContain('split');
  });

  it('NOT_PICKED: lost the competition for the session', () => {
    const plan = planDay(input(), { ...PLANNER_CONFIG, maxExercisesPerSession: 1 });
    // one hard exercise, the rest of the time is light fill and mobility
    expect(ids(plan)).toEqual(['press', 'plank', 'deadbug', 'catcow']);
    expect(plan.exercises[1]!.reasons).toEqual(['LIGHT_FILL']);
    expect(skip(plan, 'pull')).toBe('NOT_PICKED');
  });

  it('ignores sessions after the day being planned', () => {
    const plan = planDay(input({ sessions: [{ date: addDays(ASOF, 1), sets: [set('squat')] }] }));
    expect(plan.dayReasons).toContain('FIRST_DAY');
  });
});

describe('planDay — overload signals', () => {
  const grinding = [session(5, [set('squat', { rir: 0 })]), session(3, [set('squat', { rir: 0 })])];
  const noSquatSlot = block({ selections: { ...block().selections, squat: 'ghost' } });

  it('swaps a one-legged variant for a two-legged one in its slot', () => {
    const plan = planDay(input({ sessions: grinding, block: noSquatSlot }));
    expect(plan.signals).toContain('FATIGUE_HIGH');
    expect(plan.exercises.find((e) => e.slotId === 'lunge')).toMatchObject({
      exerciseId: 'goblet',
      reasons: expect.arrayContaining(['BILATERAL_SWAP']),
    });
    expect(skip(plan, 'squat')).toBe('NO_CANDIDATE');
  });

  it('drops the slot when it has nothing two-legged', () => {
    const onlySplit = slots.map((s) => (s.id === 'lunge' ? { ...s, exerciseIds: ['split'] } : s));
    const plan = planDay(input({ sessions: grinding, slots: onlySplit }));
    expect(skip(plan, 'lunge')).toBe('FATIGUE_BILATERAL_ONLY');
  });
});

describe('planDay — the shape of the day', () => {
  it('takes one rep more in reserve after a poor night', () => {
    const plan = planDay(input({ daily: [today({ sleepHours: 5 })] }));
    expect(plan.dayReasons).toContain('LOW_READINESS');
    expect(plan.exercises[0]).toMatchObject({ targetRirMin: 5, targetRirMax: 5 });
    expect(plan.exercises[0]!.reasons).toContain('LOW_READINESS');
    const tired = planDay(input({ daily: [today({ energy: 2 })] }));
    expect(tired.dayReasons).toContain('LOW_READINESS');
    expect(
      planDay(input({ daily: [today({ sleepHours: null, energy: null })] })).dayReasons,
    ).toEqual(['FIRST_DAY']);
  });

  it('runs a deload week: one set, the last load, RIR 4-5', () => {
    // two exposures, the last one inside the week: no intro, no layoff, room left
    const sessions = [session(8, [set('press')]), session(6, [set('press'), set('press')])];
    const plan = planDay(
      input({ sessions, block: block({ deloadFrom: ASOF, deloadReason: 'DELOAD_SCHEDULED' }) }),
    );
    expect(plan.phase).toBe('deload');
    expect(plan.dayReasons).toContain('DELOAD_WEEK');
    expect(plan.exercises.find((e) => e.exerciseId === 'press')).toMatchObject({
      sets: 1,
      load: db(6),
      targetRirMin: 4,
      targetRirMax: 5,
      reasons: ['DELOAD'],
    });
  });

  it.each([
    [10, 'LAYOFF_SHORT'],
    [20, 'LAYOFF_MEDIUM'],
    [40, 'LAYOFF_LONG'],
  ])('names a %s-day layoff', (gap, reason) => {
    expect(planDay(input({ sessions: [session(gap, [set('curl')])] })).dayReasons).toContain(
      reason,
    );
  });

  it('names the sessions of recalibration after a long layoff', () => {
    const sessions = [session(60, [set('curl')]), session(2, [set('curl')])];
    expect(planDay(input({ sessions })).dayReasons).toContain('LAYOFF_RECALIBRATION');
  });

  it('passes the ride through', () => {
    const rides = [{ date: ago(1), minutes: 12, resistance: 3, rpe: 5 }];
    expect(planDay(input({ rides })).bike).toEqual({
      minutes: 14,
      resistance: 3,
      reasons: ['BIKE_TIME_UP'],
    });
  });
});

describe('planDay — a short day is topped up', () => {
  const yesterday = [
    session(1, [
      set('squat'),
      set('press'),
      set('row', { load: { kind: 'band', bandId: 'red', position: 1 } }),
      set('curl'),
    ]),
  ];

  it('with light core practice at RIR 5, then mobility', () => {
    const plan = planDay(input({ sessions: yesterday }));
    expect(ids(plan)).toEqual(['plank', 'deadbug', 'catcow']);
    expect(plan.exercises.find((e) => e.exerciseId === 'deadbug')).toMatchObject({
      label: 'B1',
      targetRirMin: 5,
      targetRirMax: 5,
      target: 8,
      warmupSet: false,
      reasons: ['LIGHT_FILL'],
    });
    expect(plan.exercises.find((e) => e.exerciseId === 'catcow')).toMatchObject({
      label: 'C1',
      target: 6,
      reasons: [],
      load: { kind: 'bodyweight' },
    });
    expect(plan.dayReasons).toEqual(['LIGHT_DAY']);
    expect(plan.regions).toEqual(['core']);
  });

  it('but not with a sore muscle or a slot without an exercise', () => {
    const sore = planDay(input({ sessions: yesterday, daily: [today({ soreness: { core: 4 } })] }));
    expect(ids(sore)).toEqual(['catcow']);
    // core: an exercise the catalogue lost; core2: no selection at all
    const selections = Object.fromEntries(
      Object.entries(block().selections).filter(([slotId]) => slotId !== 'core2'),
    );
    const empty = block({ selections: { ...selections, core: 'ghost' } });
    expect(ids(planDay(input({ sessions: yesterday, block: empty })))).toEqual(['catcow']);
  });

  it('and not at all when the hard work already fills it', () => {
    expect(ids(planDay(input()))).not.toContain('catcow');
  });
});

describe('planDay — edges of the budget', () => {
  it('never adds an exercise that would run past the maximum', () => {
    const tight = { ...PLANNER_CONFIG, sessionMinutes: { min: 1, target: 20, max: 6 } };
    expect(planDay(input(), tight).exercises).toHaveLength(1);
  });

  it('stops topping up as soon as the minimum is reached', () => {
    const everything = [
      session(1, [
        set('squat'),
        set('press'),
        set('row', { load: { kind: 'band', bandId: 'red', position: 1 } }),
        set('curl'),
        set('plank', { reps: null, timeSec: 30, load: { kind: 'bodyweight' } }),
      ]),
    ];
    const short = { ...PLANNER_CONFIG, sessionMinutes: { min: 4, target: 20, max: 30 } };
    const plan = planDay(input({ sessions: everything }), short);
    expect(ids(plan)).toHaveLength(1);
    expect(plan.exercises[0]!.reasons).toEqual(['LIGHT_FILL']);
  });

  it('falls back to a default range for a mobility slot without one', () => {
    const bare = slots.map((s) => (s.id === 'mobility' ? { ...s, repRange: undefined } : s));
    const yesterday = [session(1, [set('squat'), set('press'), set('curl')])];
    const plan = planDay(
      input({
        slots: bare,
        sessions: yesterday,
        block: block({
          selections: { ...block().selections, pull: 'ghost', core: 'ghost', core2: 'ghost' },
        }),
      }),
    );
    expect(plan.exercises.find((e) => e.exerciseId === 'catcow')).toMatchObject({
      repMin: 8,
      repMax: 15,
      target: 8,
    });
  });
});

describe('planDay — ordering and validation', () => {
  it('pairs every lower-body compound with an upper-body one, then accessories and core', () => {
    const roomy = {
      ...PLANNER_CONFIG,
      sessionMinutes: { min: 20, target: 60, max: 90 },
      maxExercisesPerSession: 10,
      maxDirectSetsPerMuscleDay: 4,
    };
    const plan = planDay(input(), roomy);
    expect(plan.exercises.map((e) => `${e.label}:${e.exerciseId}`)).toEqual([
      'A1:squat',
      'A2:press',
      'B1:split',
      'B2:row',
      'C1:curl',
      'D1:plank',
      'D2:deadbug',
    ]);
  });

  it('keeps two upper-body compounds apart', () => {
    const plan = planDay(input({ sessions: [session(1, [set('squat')])] }));
    expect(plan.exercises.slice(0, 2).map((e) => e.label)).toEqual(['A1', 'B1']);
  });

  it('reports what validatePlan removed', () => {
    const plan = planDay(
      input({ eligibility: { profile: HARD_ONLY, excludedIds: new Set(['press']) } }),
    );
    expect(ids(plan)).not.toContain('press');
    expect(plan.adjustments).toEqual([{ exerciseId: 'press', code: 'USER_EXCLUDED' }]);
  });
});
