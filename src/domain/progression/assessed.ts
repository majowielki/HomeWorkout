/**
 * The history of one exercise as the rules read it: each primary exposure
 * with what it is evidence of and the step it was done at. Worked out once
 * per planning, from the records alone (no stored state, 13 §6).
 */

import type { ExposureRecord } from '../observations/exposure';
import {
  amountOf,
  type EvidenceAssessment,
  isPerformed,
  qualifyExposure,
  rangeOf,
  referenceResistance,
  requiredSets,
} from '../observations/qualify';
import type { ResistanceModel, ResistanceSpec } from '../resistance/types';
import { levelIdOf } from './levels';
import type { ProgressionPolicy } from './policy';

export interface Assessed {
  rec: ExposureRecord;
  ev: EvidenceAssessment;
  /** The resistance the next prescription stands on (`referenceResistance`); null if nothing is known of it. */
  at: ResistanceSpec | null;
  /** The step of the model that is, or null when `at` is not a step of it. */
  levelId: string | null;
  /** The range the plan carried: its bottom and top, as extended or built up. */
  planned: { lo: number; hi: number } | null;
}

export function assess(
  records: readonly ExposureRecord[],
  policy: Pick<ProgressionPolicy, 'dropOffAllowance'>,
  model: ResistanceModel,
): Assessed[] {
  return records.map((rec) => {
    const at = referenceResistance(rec, model);
    const first = requiredSets(rec)[0];
    const range = first === undefined ? null : rangeOf(first.planned);
    return {
      rec,
      ev: qualifyExposure(rec, policy, model),
      at,
      levelId: at === null ? null : levelIdOf(model, at),
      planned: range === null ? null : { lo: range.lo, hi: range.hi },
    };
  });
}

/** Whether anything of the exposure was done: an exposure with nothing done says nothing about the step. */
export const hasData = (a: Assessed): boolean => a.ev.coverage !== 'none';

/** How many logical sets the plan required: both sides of a set are one. */
export function logicalSetCount(rec: ExposureRecord): number {
  return new Set(requiredSets(rec).map((s) => s.planned.logicalSetId)).size;
}

/** The result of every required set that was done, in the order of the plan. */
export function amountOfRequired(rec: ExposureRecord): number[] {
  return requiredSets(rec).flatMap((s) => {
    const amount = isPerformed(s) ? amountOf(s.observation) : null;
    return amount === null ? [] : [amount];
  });
}

/**
 * One number per logical set, in order: the worse of its sides, since a set is only as good as its weaker
 * side. A set with no result is left out, so the list may be shorter than the plan.
 */
export function logicalAmounts(rec: ExposureRecord): number[] {
  const byLogical = new Map<string, number>();
  for (const s of requiredSets(rec)) {
    const amount = isPerformed(s) ? amountOf(s.observation) : null;
    if (amount === null) continue;
    byLogical.set(
      s.planned.logicalSetId,
      Math.min(byLogical.get(s.planned.logicalSetId) ?? amount, amount),
    );
  }
  return [...byLogical.values()];
}
