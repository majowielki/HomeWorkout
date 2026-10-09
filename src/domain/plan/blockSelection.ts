import type { Exercise } from '../types';
import { type EligibilityContext, isEligible } from './eligibility';
import type { BlockEvent } from './reasons';
import type { BlockState, Slot } from './types';

export interface BlockAdvance {
  block: BlockState;
  /** The block that ended today, when a new one began. */
  closed: BlockState | null;
  events: BlockEvent[];
  /** Slots whose exercise had to change mid-block (no longer allowed, or new slot). */
  replacedSlots: string[];
}

/**
 * The next allowed candidate after `after` in the slot's list, wrapping
 * around; the first allowed one when `after` is not in the list. `after`
 * itself is the last resort — rotation keeps an exercise only when the
 * slot has nothing else allowed.
 */
export function nextCandidate(
  slot: Slot,
  after: string | undefined,
  catalog: Readonly<Record<string, Exercise>>,
  eligibility: EligibilityContext,
): string | undefined {
  const allowed = (id: string) => {
    const exercise = catalog[id];
    return exercise !== undefined && isEligible(exercise, eligibility);
  };
  const ids = slot.exerciseIds;
  const start = after === undefined ? -1 : ids.indexOf(after);
  for (let step = 1; step <= ids.length; step += 1) {
    const id = ids[(start + step + ids.length) % ids.length]!;
    if (start !== -1 && id === after) break;
    if (allowed(id)) return id;
  }
  return after !== undefined && start !== -1 && allowed(after) ? after : undefined;
}

/**
 * Keeps every selection that is still allowed; replaces one that is not
 * (the person excluded it, the knee setting changed, the catalogue
 * retired it) with the next allowed candidate, and fills a slot that has
 * none — a slot added by a data update.
 */
export function repairSelections(
  selections: Readonly<Record<string, string>>,
  slots: readonly Slot[],
  catalog: Readonly<Record<string, Exercise>>,
  eligibility: EligibilityContext,
): { selections: Record<string, string>; replaced: string[] } {
  const out: Record<string, string> = {};
  const replaced: string[] = [];
  for (const slot of slots) {
    const current = selections[slot.id];
    const exercise = current === undefined ? undefined : catalog[current];
    const keep =
      exercise !== undefined &&
      slot.exerciseIds.includes(exercise.id) &&
      isEligible(exercise, eligibility);
    const id = keep ? current : nextCandidate(slot, current, catalog, eligibility);
    if (id !== undefined) out[slot.id] = id;
    if (id !== current) replaced.push(slot.id);
  }
  return { selections: out, replaced };
}
