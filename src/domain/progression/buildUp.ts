/**
 * Building up to the range from the person's own result (engine v2, 03 §17,
 * 13 §20, D39). Where the resistance cannot get any easier — the body, a hold,
 * the lightest dumbbell or band — a person who does 5 reps of a range of 8-12
 * used to be given 8 again and again. Here the target is what they did plus one
 * step, up to the bottom of the range, and a much easier variant is proposed
 * when the build stands still or starts far below.
 */

import { effortOf } from '../observations/effort';
import type { ExposureRecord } from '../observations/exposure';
import { amountOf, isPerformed, requiredSets } from '../observations/qualify';
import type { ResistanceModel } from '../resistance/types';
import { type Assessed, hasData, logicalAmounts } from './assessed';
import type { ProgressionPolicy } from './policy';

export interface BuildUpState {
  /** The last exposure was at the easiest resistance, complete, ordinary, and a set was under the range. */
  active: boolean;
  /** Exposures, counting from the one that gave the best total so far, built from without improving on it. */
  stalledExposures: number;
  /** The best result of a required set in the last exposure. */
  bestRequired: number;
}

const CONFOUNDERS = ['pain', 'short_rest', 'doms'] as const;

/** An exposure of a build: at the easiest resistance, complete, ordinary, and under the range at some set. */
function isBuilding(a: Assessed, model: ResistanceModel, lo: number): boolean {
  return (
    a.at !== null &&
    model.nextEasier(a.at.value) === null &&
    a.ev.performance !== 'not_evaluable' &&
    !CONFOUNDERS.some((c) => a.ev.shortfalls.includes(c)) &&
    logicalAmounts(a.rec).some((x) => x < lo)
  );
}

const total = (a: Assessed) => logicalAmounts(a.rec).reduce((sum, x) => sum + x, 0);

/**
 * Where the build stands. `since` is the day the person last said "not now" to an easier variant: what
 * came before it does not count towards the next proposal.
 */
export function buildUpState(
  history: readonly Assessed[],
  model: ResistanceModel,
  range: { lo: number },
  since?: string,
): BuildUpState {
  // A week of deload says nothing about the build: it is neither part of it nor a break in it.
  const used = history.filter(hasData).filter((a) => a.ev.context !== 'deload');
  const last = used[used.length - 1];
  if (last === undefined) return { active: false, stalledExposures: 0, bestRequired: 0 };
  const bestRequired = Math.max(0, ...logicalAmounts(last.rec));
  if (!isBuilding(last, model, range.lo)) {
    return { active: false, stalledExposures: 0, bestRequired };
  }

  const run: Assessed[] = [];
  for (let i = used.length - 1; i >= 0; i -= 1) {
    const a = used[i]!;
    if (!isBuilding(a, model, range.lo) || (since !== undefined && a.rec.trainingDate <= since)) {
      break;
    }
    run.unshift(a);
  }
  if (run.length === 0) return { active: true, stalledExposures: 0, bestRequired };
  const best = Math.max(...run.map(total));
  const firstBest = run.findIndex((a) => total(a) === best);
  return { active: true, stalledExposures: run.length - firstBest, bestRequired };
}

/**
 * The target of each required set for the next exposure: what was done plus a step, up to the bottom of
 * the range. A set done to the limit (less in reserve than the plan asked) is repeated, not raised: it is
 * not asked for more, and not for less. Never below the least a target can be.
 */
export function buildUpTargets(
  last: ExposureRecord,
  range: { lo: number },
  step: number,
  minRir: number,
  minAmount: number,
): number[] {
  const byLogical = new Map<string, { amount: number; effort: number }>();
  for (const s of requiredSets(last).filter(isPerformed)) {
    const amount = amountOf(s.observation);
    if (amount === null) continue;
    const effort = effortOf(s.observation) ?? Infinity;
    const known = byLogical.get(s.planned.logicalSetId);
    byLogical.set(s.planned.logicalSetId, {
      amount: Math.min(known?.amount ?? amount, amount),
      effort: Math.min(known?.effort ?? effort, effort),
    });
  }
  return [...byLogical.values()].map(({ amount, effort }) =>
    Math.max(minAmount, effort < minRir ? amount : Math.min(range.lo, amount + step)),
  );
}

/** Whether to put an easier variant to the person (D39): far below the range, or no better for a while. */
export function shouldSuggestVariantDown(
  s: BuildUpState,
  lo: number,
  policy: Pick<ProgressionPolicy, 'variantDownRatio' | 'variantDownStalledExposures'>,
  deferred = false,
): boolean {
  if (!s.active) return false;
  const far = !deferred && s.bestRequired <= Math.floor(lo * policy.variantDownRatio);
  return far || s.stalledExposures >= policy.variantDownStalledExposures;
}
