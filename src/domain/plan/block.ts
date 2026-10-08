import { warrantsReactiveDeload } from '../autoregulation/fatigue';
import { BLOCK_CONFIG, LAYOFF_FROM_DAYS } from '../config/training';
import { daysBetween } from '../time/trainingDate';
import type { Exercise } from '../types';
import { type EligibilityContext, isEligible } from './eligibility';
import type { BlockEvent, FatigueSignal } from './reasons';
import type { BlockState, Slot } from './types';

export type BlockPhase = 'work' | 'deload';

export function phaseOf(block: BlockState, asOf: string): BlockPhase {
  return block.deloadFrom !== null && asOf >= block.deloadFrom ? 'deload' : 'work';
}

export interface BlockContext {
  asOf: string;
  /** Training date of the latest completed session, if any. */
  lastSessionDate: string | null;
  signals: readonly FatigueSignal[];
  slots: readonly Slot[];
  catalog: Readonly<Record<string, Exercise>>;
  eligibility: EligibilityContext;
}

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

/** Every slot moves to its next candidate (SPEC §10.2); the first block takes the first. */
export function rotateSelections(
  previous: Readonly<Record<string, string>> | null,
  slots: readonly Slot[],
  catalog: Readonly<Record<string, Exercise>>,
  eligibility: EligibilityContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of slots) {
    const id = nextCandidate(slot, previous?.[slot.id], catalog, eligibility);
    if (id !== undefined) out[slot.id] = id;
  }
  return out;
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

/**
 * Where the block stands on `asOf`, SPEC §10.2:
 *
 * - no block yet → block 1 starts today with the first allowed candidates
 * - the deload week is over → the next block starts, every slot rotated
 * - 8+ days without a session in this block → the work clock restarts
 *   today (a deload right after a break would make no sense)
 * - 28 days of work → the deload week starts
 * - 2+ overload signals, a week or more in → the deload starts early
 *
 * Selections that are no longer allowed are repaired in every case.
 * Calling it again on the same day changes nothing.
 */
export function advanceBlock(
  current: BlockState | null,
  ctx: BlockContext,
  cfg = BLOCK_CONFIG,
): BlockAdvance {
  const { asOf, slots, catalog, eligibility } = ctx;

  if (current === null) {
    return {
      block: {
        index: 1,
        startedOn: asOf,
        deloadFrom: null,
        deloadReason: null,
        selections: rotateSelections(null, slots, catalog, eligibility),
      },
      closed: null,
      events: ['BLOCK_STARTED'],
      replacedSlots: [],
    };
  }

  if (current.deloadFrom !== null && daysBetween(current.deloadFrom, asOf) >= cfg.deloadDays) {
    return {
      block: {
        index: current.index + 1,
        startedOn: asOf,
        deloadFrom: null,
        deloadReason: null,
        selections: rotateSelections(current.selections, slots, catalog, eligibility),
      },
      closed: current,
      events: ['BLOCK_ROTATED'],
      replacedSlots: [],
    };
  }

  const events: BlockEvent[] = [];
  let block: BlockState = { ...current };

  if (phaseOf(block, asOf) === 'work') {
    const trainedInBlock = ctx.lastSessionDate !== null && ctx.lastSessionDate >= block.startedOn;
    const idleSince = trainedInBlock ? ctx.lastSessionDate! : block.startedOn;
    const workDays = daysBetween(block.startedOn, asOf);
    if (daysBetween(idleSince, asOf) >= LAYOFF_FROM_DAYS.short) {
      block = { ...block, startedOn: asOf };
      events.push('BLOCK_CLOCK_RESET');
    } else if (workDays >= cfg.workDays) {
      block = { ...block, deloadFrom: asOf, deloadReason: 'DELOAD_SCHEDULED' };
      events.push('DELOAD_SCHEDULED');
    } else if (workDays >= cfg.reactiveDeloadMinDays && warrantsReactiveDeload(ctx.signals)) {
      block = { ...block, deloadFrom: asOf, deloadReason: 'DELOAD_REACTIVE' };
      events.push('DELOAD_REACTIVE');
    }
  }

  const repaired = repairSelections(block.selections, slots, catalog, eligibility);
  if (repaired.replaced.length > 0) events.push('SELECTION_REPLACED');
  return {
    block: { ...block, selections: repaired.selections },
    closed: null,
    events,
    replacedSlots: repaired.replaced,
  };
}
