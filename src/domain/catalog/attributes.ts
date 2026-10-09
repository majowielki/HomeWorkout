/**
 * What the catalogue says about an exercise, read in one place (engine,
 * 05 §3, §12-§14). Most of it is derived from the fields the catalogue
 * already had; the new optional fields only refine it. A missing answer is
 * never `false`: for a joint nobody classified, the exercise is `unknown`.
 */

import { PROGRESSION_CONFIG, TRAINING_CONFIG } from '../config/training';
import type { Exercise, JointId, MedicalProfile, MuscleGroup } from '../types';

/** The main implement the resistance comes from; what an equipment preference is about (12 §3). */
export type EquipmentFamily = 'dumbbell' | 'band' | 'mini-band' | 'bike' | 'bodyweight';

export function equipmentFamilyOf(exercise: Pick<Exercise, 'equipment'>): EquipmentFamily {
  const has = (e: Exercise['equipment'][number]) => exercise.equipment.includes(e);
  if (has('band')) return 'band';
  if (has('dumbbell')) return 'dumbbell';
  if (has('mini-band')) return 'mini-band';
  if (has('bike')) return 'bike';
  return 'bodyweight';
}

/**
 * Whether the exercise loads a joint. The knee is what the catalogue has
 * always classified; any other joint is `unknown` until somebody says,
 * which is not the same as "no".
 */
export function loadsJoint(
  exercise: Pick<Exercise, 'loadsKnee' | 'jointLoading'>,
  joint: JointId,
): boolean | 'unknown' {
  if (joint === 'knee') return exercise.loadsKnee;
  return exercise.jointLoading?.[joint] ?? 'unknown';
}

/**
 * The repetitions a set is not pushed beyond (D34): a harder variant comes before more repetitions. The
 * lower ceiling for exercises that load the knee belongs to a person who has a knee profile and has not
 * switched the cautious range off; for anyone else it is the general one.
 */
export function repCapOf(
  exercise: Pick<Exercise, 'loadsKnee' | 'jointLoading'>,
  profile: MedicalProfile,
  cfg: { default: number; kneeLoading: number } = PROGRESSION_CONFIG.repCap,
): number {
  const cautious = profile.knee !== null && profile.knee.cautiousReps !== false;
  return cautious && loadsJoint(exercise, 'knee') === true ? cfg.kneeLoading : cfg.default;
}

/**
 * How much of a set counts for a secondary muscle: the person's own setting
 * for this exercise, else the catalogue's, else the policy default (D35).
 */
export function secondaryWeightOf(
  exercise: Pick<Exercise, 'secondaryWeights'>,
  muscle: MuscleGroup,
  personal?: Partial<Record<MuscleGroup, number>>,
  fallback: number = TRAINING_CONFIG.secondaryMuscleWeight,
): number {
  return personal?.[muscle] ?? exercise.secondaryWeights?.[muscle] ?? fallback;
}
