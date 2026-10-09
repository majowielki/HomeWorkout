/**
 * What the person prefers (engine, D22, D25, 12 §3-§4).
 *
 * A preference decides *between near-equal options*: a dumbbell goblet squat
 * or the same squat on a band; which of two similar variants a block uses;
 * the order of the replacements offered mid-session. It never overrides a
 * rule: an exercise the person would rather avoid is still planned when
 * nothing else fits, and "do not suggest" (a hard exclusion) is a different
 * setting altogether.
 */

import { z } from 'zod';

import { equipmentFamilyOf } from '../catalog/attributes';
import { PREFERENCE_CONFIG } from '../config/training';
import type { Slot } from '../plan/types';
import { unitOf } from '../progression/prescribe';
import { substituteScore } from '../exercises/substitute';
import type { Exercise } from '../types';

export const PREFERENCE_LEVELS = ['prefer', 'neutral', 'avoid'] as const;
export type PreferenceLevel = (typeof PREFERENCE_LEVELS)[number];

const level = z.enum(PREFERENCE_LEVELS);
const muscle = z.enum([
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'chest',
  'back',
  'lats',
  'shoulders',
  'biceps',
  'triceps',
  'core',
  'forearms',
]);

const setsOfKind = z.number().int().min(1).max(10);

export const trainingPreferencesSchema = z.strictObject({
  /** Raised on every change; a preview made under an older revision is stale. */
  revision: z.number().int().nonnegative(),
  equipment: z.partialRecord(
    z.enum(['dumbbell', 'band', 'mini-band', 'bike', 'bodyweight']),
    level,
  ),
  /** The heart for an exercise: it wins over the preference for its equipment. */
  exercises: z.record(z.string().min(1), level),
  /** `engine`: the engine recommends the sets of an exposure. `fixed`: the person's numbers, where there is room. */
  setsPerExposure: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('engine') }),
    z.strictObject({
      mode: z.literal('fixed'),
      byKind: z.partialRecord(z.enum(['compound', 'accessory', 'core', 'filler']), setsOfKind),
    }),
  ]),
  variety: z.enum(['stable', 'normal', 'varied']),
  /** The weekly volume profile: `standard` 3/4/6 sets per muscle, `higher` 4/6/10 (12 §5.4). */
  volumeProfile: z.enum(['standard', 'higher']),
  /** Weekly maximum set by the person for a muscle, after a recommendation they accepted (D32). */
  volumeOverrides: z.partialRecord(muscle, z.number().int().min(1).max(30)),
  /** How much of a set one exercise counts for each secondary muscle, set by the person (D35). */
  muscleWeights: z.record(z.string().min(1), z.partialRecord(muscle, z.number().min(0).max(1))),
});

export type TrainingPreferences = z.infer<typeof trainingPreferencesSchema>;

/** Nothing preferred, nothing avoided; the engine recommends the sets. */
export function defaultPreferences(): TrainingPreferences {
  return {
    revision: 0,
    equipment: {},
    exercises: {},
    setsPerExposure: { mode: 'engine' },
    variety: 'normal',
    volumeProfile: 'standard',
    volumeOverrides: {},
    muscleWeights: {},
  };
}

/**
 * How much the person likes an exercise: +2 for an exercise they marked, -2
 * for one they would rather avoid, otherwise +1 / 0 / -1 for its equipment.
 * What they said about the exercise itself decides before what they said about
 * the equipment (T74).
 */
export function preferenceScore(
  exercise: Pick<Exercise, 'id' | 'equipment'>,
  prefs: Pick<TrainingPreferences, 'exercises' | 'equipment'>,
): number {
  const own = prefs.exercises[exercise.id];
  if (own === 'prefer') return 2;
  if (own === 'avoid') return -2;
  const family = prefs.equipment[equipmentFamilyOf(exercise)] ?? 'neutral';
  return family === 'prefer' ? 1 : family === 'avoid' ? -1 : 0;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * Two exercises so close that either would do (T73): the catalogue says so
 * (a shared `equivalenceGroup`, which settles it), or they sit in one slot,
 * are counted the same way, train the same main muscles and are each a good
 * substitute for the other.
 */
export function nearEquivalent(
  a: Exercise,
  b: Exercise,
  slotOf: ReadonlyMap<string, Slot>,
  minScore: number = PREFERENCE_CONFIG.nearEquivalentScore,
): boolean {
  if (a.id === b.id) return true;
  if (a.equivalenceGroup !== undefined && a.equivalenceGroup === b.equivalenceGroup) return true;
  const slot = slotOf.get(a.id);
  return (
    slot !== undefined &&
    slot.id === slotOf.get(b.id)?.id &&
    unitOf(a) === unitOf(b) &&
    sameSet(a.primaryMuscles, b.primaryMuscles) &&
    substituteScore(a, b) >= minScore &&
    substituteScore(b, a) >= minScore
  );
}
