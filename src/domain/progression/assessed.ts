/**
 * The history of one exercise as the rules read it: each primary exposure
 * with what it is evidence of and the step it was done at. Worked out once
 * per planning, from the records alone (no stored state, 13 §6).
 */

import { effortOf } from '../observations/effort';
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

/** The result of every required set, in the order of the plan; for a complete, readable exposure. */
export function amountOfRequired(rec: ExposureRecord): number[] {
  // For an exposure that is complete and readable: every required set was done and has an amount.
  return requiredSets(rec).map((s) => amountOf(s.observation!)!);
}

/**
 * What each logical set came to, in the order of the plan: the worse of its sides in reps or seconds,
 * and the least in reserve of them (null if any side did not say). A set is only as good as its weaker
 * side. A set with no result is left out, so the list may be shorter than the plan.
 */
export function logicalResults(rec: ExposureRecord): { amount: number; effort: number | null }[] {
  const byLogical = new Map<string, { amount: number; effort: number | null }>();
  for (const s of requiredSets(rec).filter(isPerformed)) {
    const amount = amountOf(s.observation);
    if (amount === null) continue;
    const effort = effortOf(s.observation);
    const known = byLogical.get(s.planned.logicalSetId);
    byLogical.set(s.planned.logicalSetId, {
      amount: Math.min(known?.amount ?? amount, amount),
      effort:
        known === undefined
          ? effort
          : known.effort === null || effort === null
            ? null
            : Math.min(known.effort, effort),
    });
  }
  return [...byLogical.values()];
}

/** The amount of each logical set (see `logicalResults`). */
export const logicalAmounts = (rec: ExposureRecord): number[] =>
  logicalResults(rec).map((r) => r.amount);
