/**
 * The block of the second engine (engine v2, 03 §9, §16, D31). A block is 35
 * days and the unit of rotation; there is no planned deload week. A deload
 * starts when the signals ask for it (`reactiveDeloadTrigger`), lasts a week,
 * and the block goes on after it. The exercise of each slot for the next block
 * is chosen by `chooseBlockVariant`: the one that works stays, the one not tried
 * enough stays, otherwise the rotation moves on.
 *
 * Calling it again on the same day changes nothing.
 */

import { BLOCK_CONFIG, LAYOFF_FROM_DAYS, ROTATION_CONFIG } from '../config/training';
import type { TrainingPreferences } from '../preferences/preferences';
import type { BlockEvidence } from '../progression/stall';
import { daysBetween } from '../time/trainingDate';
import type { Exercise } from '../types';
import { type BlockAdvance, repairSelections } from './block';
import { chooseBlockSelections } from './blockVariant';
import type { EligibilityContext } from './eligibility';
import { type DeloadInput, reactiveDeloadTrigger } from './reactiveDeload';
import type { BlockEvent } from './reasons';
import type { BlockState, Slot } from './types';

/** A deload lasts its week; the block goes on after it. */
export function phaseOfV2(
  block: Pick<BlockState, 'deloadFrom'>,
  asOf: string,
  deloadDays: number = BLOCK_CONFIG.deloadDays,
): 'work' | 'deload' {
  return block.deloadFrom !== null &&
    asOf >= block.deloadFrom &&
    daysBetween(block.deloadFrom, asOf) < deloadDays
    ? 'deload'
    : 'work';
}

export interface BlockContextV2 {
  asOf: string;
  /** Training date of the latest session, if any. */
  lastSessionDate: string | null;
  slots: readonly Slot[];
  catalog: Readonly<Record<string, Exercise>>;
  eligibility: EligibilityContext;
  preferences: Pick<TrainingPreferences, 'exercises' | 'equipment' | 'variety'>;
  /** What the variant of a slot showed in the block that is ending. */
  evidence: (slot: Slot, exerciseId: string | undefined) => BlockEvidence | null;
  /** The selections of earlier blocks, newest first. */
  recentBlocks: readonly Readonly<Record<string, string>>[];
  /** The person's own choices for slots. */
  chosen?: Readonly<Record<string, string>>;
  /** What the deload is decided from. */
  deload: Omit<DeloadInput, 'asOf' | 'block'>;
}

export function advanceBlockV2(
  current: BlockState | null,
  ctx: BlockContextV2,
  cfg: Pick<typeof ROTATION_CONFIG, 'blockDays'> = ROTATION_CONFIG,
): BlockAdvance {
  const choose = (previous: Readonly<Record<string, string>> | null) =>
    chooseBlockSelections(
      ctx.slots,
      {
        catalog: ctx.catalog,
        eligibility: ctx.eligibility,
        preferences: ctx.preferences,
        recentBlocks: ctx.recentBlocks,
      },
      previous,
      ctx.evidence,
      ctx.chosen,
    ).selections;

  if (current === null) {
    return {
      block: {
        index: 1,
        startedOn: ctx.asOf,
        deloadFrom: null,
        deloadReason: null,
        selections: choose(null),
      },
      closed: null,
      events: ['BLOCK_STARTED'],
      replacedSlots: [],
    };
  }

  if (daysBetween(current.startedOn, ctx.asOf) >= cfg.blockDays) {
    return {
      block: {
        index: current.index + 1,
        startedOn: ctx.asOf,
        deloadFrom: null,
        deloadReason: null,
        selections: choose(current.selections),
      },
      closed: current,
      events: ['BLOCK_ROTATED'],
      replacedSlots: [],
    };
  }

  const events: BlockEvent[] = [];
  let block: BlockState = { ...current };
  const trained = ctx.lastSessionDate !== null && ctx.lastSessionDate >= block.startedOn;
  const idleSince = trained ? ctx.lastSessionDate! : block.startedOn;
  if (daysBetween(idleSince, ctx.asOf) >= LAYOFF_FROM_DAYS.short) {
    // A break restarts the clock of the block: a deload straight after one would make no sense.
    block = { ...block, startedOn: ctx.asOf };
    events.push('BLOCK_CLOCK_RESET');
  } else {
    const verdict = reactiveDeloadTrigger({ ...ctx.deload, asOf: ctx.asOf, block });
    if (verdict.trigger) {
      block = { ...block, deloadFrom: ctx.asOf, deloadReason: 'DELOAD_REACTIVE' };
      events.push('DELOAD_REACTIVE');
    }
  }

  const repaired = repairSelections(block.selections, ctx.slots, ctx.catalog, ctx.eligibility);
  if (repaired.replaced.length > 0) events.push('SELECTION_REPLACED');
  return {
    block: { ...block, selections: repaired.selections },
    closed: null,
    events,
    replacedSlots: repaired.replaced,
  };
}
