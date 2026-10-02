import { MUSCLE_GROUPS } from '../coach/vocabulary';
import {
  countsAsVolume,
  type VolumeExercise,
  type VolumeSet,
  volumeStatus,
  weeklyVolume,
} from '../volume/weekly';

const END = '2026-10-07';

const exercises: Record<string, VolumeExercise> = {
  squat: {
    movementPattern: 'Squat',
    primaryMuscles: ['quads', 'glutes'],
    secondaryMuscles: ['core'],
  },
  row: { movementPattern: 'Pull', primaryMuscles: ['back'], secondaryMuscles: ['biceps', 'core'] },
  catCow: { movementPattern: 'Mobility', primaryMuscles: ['back', 'core'], secondaryMuscles: [] },
  bike: { movementPattern: 'Cardio', primaryMuscles: ['quads'], secondaryMuscles: ['calves'] },
};

const set = (patch: Partial<VolumeSet> = {}): VolumeSet => ({
  exerciseId: 'squat',
  date: END,
  isWarmup: false,
  rir: 2,
  ...patch,
});

describe('weeklyVolume', () => {
  it('lists every muscle group, at zero when untouched', () => {
    const out = weeklyVolume([], exercises, END);
    expect(Object.keys(out).sort()).toEqual([...MUSCLE_GROUPS].sort());
    expect(Object.values(out).every((v) => v === 0)).toBe(true);
  });

  it('gives a primary muscle 1 and a secondary muscle 0.5 per set', () => {
    const out = weeklyVolume([set(), set(), set({ exerciseId: 'row' })], exercises, END);
    expect(out.quads).toBe(2);
    expect(out.glutes).toBe(2);
    expect(out.core).toBe(1.5); // 2 x 0.5 from squats + 0.5 from the row
    expect(out.back).toBe(1);
    expect(out.biceps).toBe(0.5);
  });

  it('covers 7 days ending on the end date, inclusive', () => {
    const sets = [
      set({ date: '2026-10-01' }), // 6 days back: in
      set({ date: '2026-09-30' }), // 7 days back: out
      set({ date: '2026-10-08' }), // after the end: out
    ];
    expect(weeklyVolume(sets, exercises, END).quads).toBe(1);
  });

  it('skips warm-ups', () => {
    expect(weeklyVolume([set({ isWarmup: true })], exercises, END).quads).toBe(0);
  });

  it('counts sets up to RIR 4 and counts a missing RIR', () => {
    const sets = [set({ rir: 4 }), set({ rir: 5 }), set({ rir: null })];
    expect(weeklyVolume(sets, exercises, END).quads).toBe(2);
  });

  it('ignores an exercise it does not know', () => {
    expect(weeklyVolume([set({ exerciseId: 'ghost' })], exercises, END).quads).toBe(0);
  });

  it('does not count mobility or cardio as hard sets', () => {
    const out = weeklyVolume(
      [set({ exerciseId: 'catCow' }), set({ exerciseId: 'bike' })],
      exercises,
      END,
    );
    expect(out.back).toBe(0);
    expect(out.core).toBe(0);
    expect(out.quads).toBe(0);
  });
});

describe('countsAsVolume', () => {
  it.each([
    ['Squat', true],
    ['Core', true],
    ['Mobility', false],
    ['Cardio', false],
  ] as const)('%s -> %s', (movementPattern, expected) => {
    expect(countsAsVolume({ movementPattern })).toBe(expected);
  });
});

describe('volumeStatus', () => {
  it.each([
    [0, 'below_min'],
    [2.5, 'below_min'],
    [3, 'in_range'],
    [6, 'in_range'],
    [6.5, 'above_max'],
  ])('%s sets -> %s', (sets, status) => {
    expect(volumeStatus(sets)).toBe(status);
  });
});
