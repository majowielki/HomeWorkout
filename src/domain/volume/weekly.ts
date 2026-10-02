import { MUSCLE_GROUPS, type VolumeStatus } from '../coach/vocabulary';
import { TRAINING_CONFIG } from '../config/training';
import { daysBetween } from '../time/trainingDate';
import type { MovementPattern, MuscleGroup } from '../types';

export interface VolumeSet {
  exerciseId: string;
  /** Training date of the session, 'YYYY-MM-DD'. */
  date: string;
  isWarmup: boolean;
  rir: number | null;
}

/** What counting volume reads from the config; a caller may count direct sets only. */
export interface VolumeConfig {
  workingSetMaxRir: number;
  secondaryMuscleWeight: number;
  volumeExcludedPatterns: readonly MovementPattern[];
}

export interface VolumeExercise {
  movementPattern: MovementPattern;
  primaryMuscles: readonly MuscleGroup[];
  secondaryMuscles: readonly MuscleGroup[];
}

/**
 * Whether sets of this exercise count towards a muscle's weekly volume.
 * Cat-cow lists "back" as its primary muscle, but it is not a hard set for
 * the back, and the bike is not one for the quads (SPEC §4.2, v1.2).
 */
export function countsAsVolume(
  exercise: Pick<VolumeExercise, 'movementPattern'>,
  cfg: Pick<VolumeConfig, 'volumeExcludedPatterns'> = TRAINING_CONFIG,
): boolean {
  return !cfg.volumeExcludedPatterns.includes(exercise.movementPattern);
}

/**
 * Working sets per muscle group over the 7 days ending on `endDate`
 * (inclusive). SPEC §4.2: a primary muscle earns a full set, a secondary
 * one half; warm-ups do not count; a set with no recorded RIR counts,
 * because skipping the field is not the same as an easy set; mobility and
 * cardio do not count at all.
 */
export function weeklyVolume(
  sets: readonly VolumeSet[],
  exercises: Readonly<Record<string, VolumeExercise>>,
  endDate: string,
  cfg: VolumeConfig = TRAINING_CONFIG,
): Record<MuscleGroup, number> {
  const out = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>;

  for (const set of sets) {
    const age = daysBetween(set.date, endDate);
    if (age < 0 || age >= 7) continue;
    if (set.isWarmup || (set.rir !== null && set.rir > cfg.workingSetMaxRir)) continue;
    const exercise = exercises[set.exerciseId];
    if (!exercise || !countsAsVolume(exercise, cfg)) continue;
    for (const muscle of exercise.primaryMuscles) out[muscle] += 1;
    for (const muscle of exercise.secondaryMuscles) out[muscle] += cfg.secondaryMuscleWeight;
  }
  return out;
}

/** The weekly maximum of direct sets for one muscle (SPEC §4.1, with the overrides). */
export function maxDirectSets(
  muscle: MuscleGroup,
  cfg: Pick<
    typeof TRAINING_CONFIG,
    'weeklyWorkingSetsPerMuscle' | 'maxDirectSetsOverride'
  > = TRAINING_CONFIG,
): number {
  return cfg.maxDirectSetsOverride[muscle] ?? cfg.weeklyWorkingSetsPerMuscle.max;
}

export function volumeStatus(sets: number, cfg = TRAINING_CONFIG): VolumeStatus {
  const { min, max } = cfg.weeklyWorkingSetsPerMuscle;
  if (sets < min) return 'below_min';
  return sets > max ? 'above_max' : 'in_range';
}
