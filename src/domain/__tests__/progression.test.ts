import { PROGRESSION_CONFIG } from '../config/training';
import { doubleProgression, type DoubleProgressionParams } from '../progression/doubleProgression';
import {
  amountOf,
  byTrainingDay,
  type Exposure,
  exposuresOf,
  firstOfEachDay,
  type HistorySet,
} from '../progression/history';
import { BODYWEIGHT_LADDER, bandLoadLadder, dumbbellLoadLadder } from '../progression/ladder';
import type { LayoffState } from '../progression/layoff';
import { prescribe, type PrescribeInput, unitOf } from '../progression/prescribe';
import type { PlannedLoad } from '../types';
import { exercise, slot } from './fixtures';

const db = (kg: number): PlannedLoad => ({ kind: 'dumbbell', mode: 'paired', kg });
const band = (bandId: string, position: 0 | 1 | 2 | 3): PlannedLoad => ({
  kind: 'band',
  bandId,
  position,
});
const bw: PlannedLoad = { kind: 'bodyweight' };

const set = (patch: Partial<HistorySet> = {}): HistorySet => ({
  exerciseId: 'press',
  isWarmup: false,
  reps: 10,
  timeSec: null,
  rir: 2,
  load: db(6),
  ...patch,
});

const exposure = (load: PlannedLoad, amounts: number[], rir: number | null = 2): Exposure => ({
  date: '2026-10-01',
  load,
  sets: amounts.map((reps) => set({ load, reps, rir })),
  warmupMissing: false,
});

const paired = dumbbellLoadLadder('paired', 4);
const params: DoubleProgressionParams = { range: [8, 15], step: 1, minRir: 2, unit: 'reps' };

describe('amountOf', () => {
  it('reads reps or seconds', () => {
    expect(amountOf(set({ reps: 12 }), 'reps')).toBe(12);
    expect(amountOf(set({ reps: null, timeSec: 40 }), 'sec')).toBe(40);
  });
});

describe('exposuresOf', () => {
  it('keeps only working sets at the heaviest load, per session', () => {
    const sessions = [
      {
        date: '2026-10-01',
        sets: [
          set({ isWarmup: true, load: db(2) }),
          set({ load: db(6), reps: 12 }),
          set({ load: db(4), reps: 15 }),
          set({ exerciseId: 'other', load: db(10) }),
          set({ load: db(6), reps: 11 }),
        ],
      },
    ];
    const [only] = exposuresOf('press', sessions, paired, 'reps', false);
    expect(only).toMatchObject({ date: '2026-10-01', load: db(6), warmupMissing: false });
    expect(only!.sets.map((s) => s.reps)).toEqual([12, 11]);
  });

  it('drops sessions with nothing comparable: other exercise, other ladder, empty amount', () => {
    const sessions = [
      { date: '2026-09-01', sets: [set({ exerciseId: 'other' })] },
      { date: '2026-09-02', sets: [set({ load: band('red', 1) })] },
      { date: '2026-09-03', sets: [set({ reps: null })] },
      { date: '2026-09-04', sets: [set({ isWarmup: true })] },
    ];
    expect(exposuresOf('press', sessions, paired, 'reps', false)).toEqual([]);
  });

  it('sets aside a band set that no warm-up preceded (SPEC §5.6)', () => {
    const ladder = bandLoadLadder('red', 50);
    const r = band('red', 2);
    const cold = {
      date: '2026-10-01',
      sets: [set({ load: r, reps: 15 }), set({ load: r, reps: 12 })],
    };
    const warm = {
      date: '2026-10-02',
      sets: [set({ load: r, isWarmup: true }), set({ load: r, reps: 15 })],
    };
    const [a, b] = exposuresOf('press', [cold, warm], ladder, 'reps', true);
    expect(a).toMatchObject({ warmupMissing: true });
    expect(a!.sets.map((s) => s.reps)).toEqual([12]);
    expect(b).toMatchObject({ warmupMissing: false });
  });
});

describe('doubleProgression', () => {
  it('goes up a rung when every set hit the top with RIR in target', () => {
    expect(doubleProgression([exposure(db(6), [15, 15])], paired, params)).toEqual({
      load: db(8),
      target: 8,
      reasons: ['REP_TARGET_MET'],
      confidence: 'high',
    });
  });

  it('lets a missing RIR through', () => {
    expect(doubleProgression([exposure(db(6), [15, 15], null)], paired, params).load).toEqual(
      db(8),
    );
  });

  it('holds at the top of the range at the ceiling', () => {
    expect(doubleProgression([exposure(db(10), [15, 15])], paired, params)).toEqual({
      load: db(10),
      target: 15,
      reasons: ['LOAD_CEILING_REACHED'],
      confidence: 'high',
    });
    expect(doubleProgression([exposure(bw, [15, 15])], BODYWEIGHT_LADDER, params).reasons).toEqual([
      'BODYWEIGHT_CEILING',
    ]);
  });

  it('passes the band ladder reason through', () => {
    const ladder = bandLoadLadder('red', 50);
    expect(doubleProgression([exposure(band('red', 1), [15, 15])], ladder, params)).toMatchObject({
      load: band('red', 2),
      reasons: ['BAND_MICRO_PROGRESSION'],
    });
  });

  it('holds when the top came with too little in reserve', () => {
    expect(doubleProgression([exposure(db(6), [15, 15], 0)], paired, params)).toEqual({
      load: db(6),
      target: 15,
      reasons: ['RIR_BELOW_TARGET'],
      confidence: 'high',
    });
  });

  it('adds one rep to the first set short of the top', () => {
    expect(doubleProgression([exposure(db(6), [15, 12, 10])], paired, params)).toEqual({
      load: db(6),
      target: 13,
      reasons: ['REP_PROGRESSION'],
      confidence: 'high',
    });
  });

  it('never targets below the range', () => {
    expect(doubleProgression([exposure(db(6), [5])], paired, params).target).toBe(8);
  });

  it('steps down after two exposures below the range at the same load', () => {
    const twice = [exposure(db(6), [9, 7]), exposure(db(6), [7, 6])];
    expect(doubleProgression(twice, paired, params)).toEqual({
      load: db(4),
      target: 8,
      reasons: ['PERFORMANCE_REGRESSION'],
      confidence: 'high',
    });
  });

  it('stays put at the floor, and does not call it a step down (D39 e)', () => {
    const twice = [exposure(db(2), [5]), exposure(db(2), [5])];
    expect(doubleProgression(twice, paired, params)).toEqual({
      load: db(2),
      target: 8,
      reasons: ['REP_PROGRESSION'],
      confidence: 'high',
    });
  });

  it.each([
    ['bodyweight', BODYWEIGHT_LADDER, bw],
    ['the lightest band', bandLoadLadder('yellow', 50), band('yellow', 0)],
  ])('never reports a step down on %s, where there is none', (_, ladder, load) => {
    const twice = [exposure(load, [4, 3]), exposure(load, [5, 4])];
    const decision = doubleProgression(twice, ladder, params);
    expect(decision.load).toEqual(load);
    expect(decision.reasons).not.toContain('PERFORMANCE_REGRESSION');
  });

  it('does not count a miss at another load, or a single miss, as regression', () => {
    expect(
      doubleProgression([exposure(db(4), [6]), exposure(db(6), [7])], paired, params).reasons,
    ).toEqual(['REP_PROGRESSION']);
    expect(
      doubleProgression([exposure(db(6), [12]), exposure(db(6), [7])], paired, params).reasons,
    ).toEqual(['REP_PROGRESSION']);
  });

  it('works on seconds with a 5-second step', () => {
    const hold = exposure(bw, []);
    hold.sets = [set({ load: bw, reps: null, timeSec: 30 })];
    expect(
      doubleProgression([hold], BODYWEIGHT_LADDER, {
        range: [20, 60],
        step: 5,
        minRir: 1,
        unit: 'sec',
      }),
    ).toMatchObject({ target: 35, reasons: ['REP_PROGRESSION'] });
  });
});

describe('prescribe', () => {
  const press = exercise({ id: 'press', equipment: ['dumbbell'], dumbbellMode: 'paired' });
  const pressSlot = slot({ repRange: [8, 15], rir: [2, 3], start: { paired: 4 } });
  const none: LayoffState = { tier: 'none', gapDays: 1, recalibrating: false };
  const session = (date: string, reps: number[], load = db(6)) => ({
    date,
    sets: reps.map((r) => set({ load, reps: r })),
  });
  const input = (patch: Partial<PrescribeInput> = {}): PrescribeInput => ({
    exercise: press,
    slot: pressSlot,
    sessions: [],
    asOf: '2026-10-10',
    layoff: none,
    ...patch,
  });

  it('starts a never-done exercise light, at the bottom of the range, RIR 4', () => {
    expect(prescribe(input())).toEqual({
      load: db(4),
      unit: 'reps',
      target: 8,
      range: [8, 15],
      rir: [4, 4],
      warmupSet: false,
      reasons: ['FIRST_EXPOSURE'],
      confidence: 'low',
    });
  });

  it('runs the second session at RIR 4 too, with progression already on', () => {
    expect(prescribe(input({ sessions: [session('2026-10-08', [15, 15])] }))).toMatchObject({
      load: db(8),
      rir: [4, 4],
      reasons: ['REP_TARGET_MET', 'INTRO_EXPOSURE'],
      confidence: 'low',
    });
  });

  it('uses the slot RIR from the third session on', () => {
    const sessions = [session('2026-10-06', [10]), session('2026-10-08', [11])];
    expect(prescribe(input({ sessions }))).toMatchObject({
      load: db(6),
      target: 12,
      rir: [2, 3],
      reasons: ['REP_PROGRESSION'],
      confidence: 'high',
    });
  });

  it('brings an exercise back one step lighter after a month away', () => {
    expect(prescribe(input({ sessions: [session('2026-09-01', [15, 15])] }))).toMatchObject({
      load: db(4),
      target: 8,
      rir: [4, 4],
      reasons: ['RE_EXPOSURE'],
    });
    const floor = [session('2026-09-01', [10], db(2))];
    expect(prescribe(input({ sessions: floor })).load).toEqual(db(2));
  });

  it('repeats the last session after a short layoff, without progression', () => {
    const sessions = [session('2026-09-28', [15, 15]), session('2026-09-30', [15, 15])];
    const short: LayoffState = { tier: 'short', gapDays: 10, recalibrating: false };
    expect(prescribe(input({ sessions, layoff: short }))).toMatchObject({
      load: db(6),
      target: 15,
      reasons: ['LAYOFF_SHORT'],
    });
    const few = [session('2026-09-28', [10]), session('2026-09-30', [5])];
    expect(prescribe(input({ sessions: few, layoff: short })).target).toBe(8);
  });

  it('steps down after a medium layoff', () => {
    const sessions = [session('2026-09-20', [15, 15]), session('2026-09-22', [15, 15])];
    const medium: LayoffState = { tier: 'medium', gapDays: 18, recalibrating: false };
    expect(prescribe(input({ sessions, layoff: medium }))).toMatchObject({
      load: db(4),
      target: 8,
      reasons: ['LAYOFF_MEDIUM'],
    });
    const floor = [session('2026-09-20', [9], db(2)), session('2026-09-22', [9], db(2))];
    expect(prescribe(input({ sessions: floor, layoff: medium })).load).toEqual(db(2));
  });

  it('runs at RIR 4 while recalibrating after a long layoff', () => {
    const sessions = [session('2026-10-06', [10]), session('2026-10-08', [11])];
    const back: LayoffState = { tier: 'none', gapDays: 2, recalibrating: true };
    expect(prescribe(input({ sessions, layoff: back }))).toMatchObject({
      rir: [4, 4],
      reasons: ['REP_PROGRESSION', 'LAYOFF_RECALIBRATION'],
    });
  });

  it('keeps load and reps in a deload week, at RIR 4-5 (SPEC §6.2)', () => {
    const sessions = [session('2026-10-06', [15, 15]), session('2026-10-08', [15, 15])];
    expect(prescribe(input({ sessions, deload: true }))).toMatchObject({
      load: db(6),
      target: 15,
      rir: [4, 5],
      reasons: ['DELOAD'],
    });
  });

  it('lets a medium layoff step down even in a deload week', () => {
    const sessions = [session('2026-09-20', [15]), session('2026-09-22', [15])];
    const medium: LayoffState = { tier: 'medium', gapDays: 18, recalibrating: false };
    expect(prescribe(input({ sessions, deload: true, layoff: medium }))).toMatchObject({
      load: db(4),
      rir: [4, 5],
      reasons: ['LAYOFF_MEDIUM'],
    });
  });

  it('starts a never-done exercise at RIR 4-5 in a deload week', () => {
    expect(prescribe(input({ deload: true }))).toMatchObject({
      rir: [4, 5],
      reasons: ['FIRST_EXPOSURE'],
    });
  });

  it('no longer asks for a band warm-up set or sets the first band set aside (SPEC v1.3)', () => {
    const row = exercise({ id: 'press', equipment: ['band'] });
    const r = band('red', 1);
    const sessions = [
      { date: '2026-10-06', sets: [set({ load: r, reps: 10 }), set({ load: r, reps: 10 })] },
    ];
    expect(prescribe(input({ exercise: row, sessions }))).toMatchObject({
      warmupSet: false,
      reasons: ['REP_PROGRESSION', 'INTRO_EXPOSURE'],
    });
  });

  it('with the band warm-up switched back on, asks for one and reports a missed one', () => {
    const row = exercise({ id: 'press', equipment: ['band'] });
    const r = band('red', 1);
    const sessions = [
      { date: '2026-10-06', sets: [set({ load: r, reps: 10 }), set({ load: r, reps: 10 })] },
    ];
    const cfg = { ...PROGRESSION_CONFIG, requireBandWarmup: true };
    expect(prescribe(input({ exercise: row, sessions }), cfg)).toMatchObject({
      warmupSet: true,
      reasons: ['REP_PROGRESSION', 'INTRO_EXPOSURE', 'WARMUP_MISSING'],
    });
  });

  it('prescribes a hold in seconds from the time range', () => {
    const plank = exercise({ id: 'plank', forceProfile: 'Isometric', movementPattern: 'Core' });
    expect(
      prescribe(input({ exercise: plank, slot: slot({ timeRange: [20, 60], start: {} }) })),
    ).toMatchObject({ unit: 'sec', target: 20, range: [20, 60], load: bw });
  });

  it('progresses a hold in 5-second steps', () => {
    const plank = exercise({ id: 'plank', forceProfile: 'Isometric', movementPattern: 'Core' });
    const sessions = [
      {
        date: '2026-10-08',
        sets: [set({ exerciseId: 'plank', load: bw, reps: null, timeSec: 30 })],
      },
    ];
    expect(
      prescribe(
        input({
          exercise: plank,
          sessions,
          slot: slot({ timeRange: [20, 60], rir: [1, 2], start: {} }),
        }),
      ),
    ).toMatchObject({ target: 35, reasons: ['REP_PROGRESSION', 'INTRO_EXPOSURE'] });
  });

  it('falls back to default ranges when the slot lacks one', () => {
    const plank = exercise({ id: 'plank', forceProfile: 'Isometric' });
    expect(prescribe(input({ exercise: plank, slot: slot({ start: {} }) })).range).toEqual([
      20, 60,
    ]);
    expect(
      prescribe(input({ slot: slot({ repRange: undefined, start: { paired: 4 } }) })).range,
    ).toEqual([8, 15]);
  });
});

describe('unitOf', () => {
  it('is seconds for isometric work', () => {
    expect(unitOf({ forceProfile: 'Isometric' })).toBe('sec');
    expect(unitOf({ forceProfile: 'ConcentricEccentric' })).toBe('reps');
  });
});

describe('sessions on the same training day', () => {
  const morning = { date: '2026-10-08', sets: [set({ reps: 15 }), set({ reps: 15 })] };
  const evening = { date: '2026-10-08', sets: [set({ reps: 6 }), set({ reps: 6 })] };
  const before = { date: '2026-10-06', sets: [set({ reps: 12 })] };

  it('joins them into one day, in order, and leaves other days alone', () => {
    expect(byTrainingDay([before, morning, evening])).toEqual([
      before,
      { date: '2026-10-08', sets: [...morning.sets, ...evening.sets] },
    ]);
    expect(byTrainingDay([])).toEqual([]);
  });

  it('keeps each session as its own exposure, and progression compares the first of the day', () => {
    const all = exposuresOf('press', [before, morning, evening], paired, 'reps', false);
    expect(all.map((e) => [e.date, e.sets.map((s) => s.reps)])).toEqual([
      ['2026-10-06', [12]],
      ['2026-10-08', [15, 15]],
      ['2026-10-08', [6, 6]],
    ]);
    expect(firstOfEachDay(all).map((e) => e.sets.map((s) => s.reps))).toEqual([[12], [15, 15]]);
  });

  it('does not let a tired repeat in an evening session hold back the morning result', () => {
    const press = exercise({ id: 'press', equipment: ['dumbbell'], dumbbellMode: 'paired' });
    const pressSlot = slot({ repRange: [8, 15], rir: [2, 3], start: { paired: 4 } });
    const layoff: LayoffState = { tier: 'none', gapDays: 1, recalibrating: false };
    const base = { exercise: press, slot: pressSlot, asOf: '2026-10-10', layoff };
    const morningOnly = prescribe({ ...base, sessions: [before, morning] });
    expect(prescribe({ ...base, sessions: [before, morning, evening] })).toEqual(morningOnly);
    expect(morningOnly.reasons).toContain('REP_TARGET_MET');
  });
});
