import { type ExclusionCode, screenExercise } from '../exercises/screen';
import { AVAILABLE_EQUIPMENT } from '../inventory';
import type { Equipment, Exercise, MedicalProfile } from '../types';
import type { Slot } from './types';

/**
 * Everything that decides whether an exercise may appear in a plan at all:
 * the knee, the person's own "do not suggest" list, retired catalogue
 * entries and the equipment in the room.
 */
export interface EligibilityContext {
  profile: MedicalProfile;
  /** Exercises the person asked never to be offered again. */
  excludedIds: ReadonlySet<string>;
  equipment?: readonly Equipment[];
}

export type IneligibleReason = ExclusionCode | 'USER_EXCLUDED' | 'ARCHIVED' | 'EQUIPMENT_MISSING';

/** Every reason the exercise is out; empty when it may be planned. */
export function ineligibility(exercise: Exercise, ctx: EligibilityContext): IneligibleReason[] {
  const out: IneligibleReason[] = [...screenExercise(exercise, ctx.profile)];
  if (ctx.excludedIds.has(exercise.id)) out.push('USER_EXCLUDED');
  if (exercise.archived) out.push('ARCHIVED');
  const room = ctx.equipment ?? AVAILABLE_EQUIPMENT;
  if (!exercise.equipment.every((e) => room.includes(e))) out.push('EQUIPMENT_MISSING');
  return out;
}

export function isEligible(exercise: Exercise, ctx: EligibilityContext): boolean {
  return ineligibility(exercise, ctx).length === 0;
}

/** The slot's candidates that may be planned, in rotation order. */
export function allowedCandidates(
  slot: Slot,
  catalog: Readonly<Record<string, Exercise>>,
  ctx: EligibilityContext,
): Exercise[] {
  return slot.exerciseIds
    .map((id) => catalog[id])
    .filter((e): e is Exercise => e !== undefined && isEligible(e, ctx));
}

/** Which slot an exercise belongs to. The data check guarantees at most one. */
export function slotByExercise(slots: readonly Slot[]): ReadonlyMap<string, Slot> {
  const out = new Map<string, Slot>();
  for (const slot of slots) for (const id of slot.exerciseIds) out.set(id, slot);
  return out;
}
