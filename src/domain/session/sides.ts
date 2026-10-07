import type { Exercise, MedicalProfile, MuscleGroup, Side } from '../types';

const LEGS: ReadonlySet<MuscleGroup> = new Set(['quads', 'hamstrings', 'glutes', 'calves']);

/**
 * The order of the two sides of an exercise done one side per set, or
 * null for anything else. Leg work starts on the weaker knee's side: that
 * leg sets how many reps are safe, and the stronger one matches it rather
 * than setting a number the weaker one would chase with poor form
 * (Documents/PLAN-TYGODNIA-I-POPRAWKI.md, appendix D). Everything else
 * starts on the left.
 */
export function sideOrder(
  exercise: Pick<Exercise, 'sides' | 'loadsKnee' | 'primaryMuscles'>,
  profile: MedicalProfile,
): readonly [Side, Side] | null {
  if (exercise.sides !== 'perSet') return null;
  const legWork = exercise.loadsKnee || exercise.primaryMuscles.some((m) => LEGS.has(m));
  return legWork && profile.knee?.side === 'right' ? ['right', 'left'] : ['left', 'right'];
}
