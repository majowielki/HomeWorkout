import catalogue from '@data/exercises.json';

import { sideOrder } from '@/domain/session/sides';
import type { StepOptions } from '@/domain/session/steps';
import type { Exercise, MedicalProfile } from '@/domain/types';

const BY_ID = new Map((catalogue as { exercises: Exercise[] }).exercises.map((e) => [e.id, e]));

/**
 * The `sidesOf` of a session's steps: an exercise done one side per set
 * gets a step per side, the weaker knee's side first for leg work. Reads
 * the bundled catalogue — the same data the database is seeded from — so
 * the steps can be built before any query returns. `swaps` are today's
 * substitutes by block index; the exercise actually done decides.
 */
export function sessionSides(
  profile: MedicalProfile,
  swaps: Readonly<Record<number, string>> = {},
): NonNullable<StepOptions['sidesOf']> {
  return (block, blockIndex) => {
    const exercise = BY_ID.get(swaps[blockIndex] ?? block.exerciseId);
    return exercise ? sideOrder(exercise, profile) : null;
  };
}
