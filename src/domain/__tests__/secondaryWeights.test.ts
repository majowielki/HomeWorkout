/**
 * Engine v2, P3 (13 §18, T95, D35): how much of a set counts for a secondary muscle.
 */
import { type VolumeExercise, type VolumeSet, weeklyVolume } from '../volume/weekly';

const END = '2026-10-07';
const exercises: Record<string, VolumeExercise> = {
  row: {
    movementPattern: 'Pull',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps', 'shoulders', 'core'],
    secondaryWeights: { biceps: 0.5, shoulders: 0.25 },
  },
};
const sets: VolumeSet[] = [0, 1].map(() => ({
  exerciseId: 'row',
  date: END,
  isWarmup: false,
  rir: 2,
}));

describe('T95 the weight of a secondary muscle', () => {
  it('is the catalogue’s for the exercise, and the default where it says nothing', () => {
    const out = weeklyVolume(sets, exercises, END);
    expect(out.back).toBe(2);
    expect(out.biceps).toBe(1);
    expect(out.shoulders).toBe(0.5);
    expect(out.core).toBe(1);
  });

  it('is the person’s own where they set one', () => {
    const out = weeklyVolume(sets, exercises, END, undefined, { row: { biceps: 0.25, core: 0 } });
    expect(out.biceps).toBe(0.5);
    expect(out.core).toBe(0);
    expect(out.shoulders).toBe(0.5);
  });

  it('does not change the primary muscles', () => {
    expect(weeklyVolume(sets, exercises, END, undefined, { row: { back: 0.1 } }).back).toBe(2);
  });
});
