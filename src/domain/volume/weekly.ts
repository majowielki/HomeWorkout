import { MUSCLE_GROUPS, type VolumeStatus } from '../coach/vocabulary';
import { TRAINING_CONFIG } from '../config/training';
import { daysBetween } from '../time/trainingDate';
import type { MuscleGroup } from '../types';

export interface VolumeSet {
  exerciseId: string;
  /** Training date of the session, 'YYYY-MM-DD'. */
  date: string;
  isWarmup: boolean;
  rir: number | null;
}

export interface VolumeExercise {
  primaryMuscles: readonly MuscleGroup[];
  secondaryMuscles: readonly MuscleGroup[];
}

/**
 * Working sets per muscle group over the 7 days ending on `endDate`
 * (inclusive). SPEC §4.2: a primary muscle earns a full set, a secondary
 * one half; warm-ups do not count; a set with no recorded RIR counts,
 * because skipping the field is not the same as an easy set.
 */
export function weeklyVolume(
  sets: readonly VolumeSet[],
  exercises: Readonly<Record<string, VolumeExercise>>,
  endDate: string,
  cfg = TRAINING_CONFIG,
): Record<MuscleGroup, number> {
  const out = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>;

  for (const set of sets) {
    const age = daysBetween(set.date, endDate);
    if (age < 0 || age >= 7) continue;
    if (set.isWarmup || (set.rir !== null && set.rir > cfg.workingSetMaxRir)) continue;
    const exercise = exercises[set.exerciseId];
    if (!exercise) continue;
    for (const muscle of exercise.primaryMuscles) out[muscle] += 1;
    for (const muscle of exercise.secondaryMuscles) out[muscle] += cfg.secondaryMuscleWeight;
  }
  return out;
}

export function volumeStatus(sets: number, cfg = TRAINING_CONFIG): VolumeStatus {
  const { min, max } = cfg.weeklyWorkingSetsPerMuscle;
  if (sets < min) return 'below_min';
  return sets > max ? 'above_max' : 'in_range';
}
