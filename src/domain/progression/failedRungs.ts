/**
 * A step that was tried and failed (engine v2, 03 §12, 13 §6, D23).
 *
 * With dumbbells that grow by 25-100% a step, plain double progression goes
 * up, fails twice, goes down and goes straight up again. The remedy needs no
 * model of strength: it remembers what happened. Where a step up was followed
 * by a failure and a return to the step below, the next step up is not offered
 * until the person has shown more at the lower one — a longer range or one more
 * set — and until then something between "hold" and "step up" is prescribed.
 *
 * Nothing is stored. The memory is read off the history every time, so a
 * correction of an old result changes it, and two planners that see the same
 * history see the same memory.
 */

import { daysBetween } from '../time/trainingDate';
import { isFailure } from '../observations/qualify';
import type { ResistanceModel } from '../resistance/types';
import { type Assessed, amountOfRequired, hasData, logicalSetCount } from './assessed';

export interface FailedRung {
  /** The step where the step up failed. */
  level: string;
  failedOn: string;
  /** The step the person went back to. */
  returnedTo: string;
  cleared: boolean;
  clearProgress: { topExposures: number; axisDone: boolean };
}

export interface FailedRungOptions {
  asOf: string;
  expiryDays: number;
  /** The slot’s range; the top of it is what a failed step was expected to be met at. */
  range: { lo: number; hi: number };
  /** The top a set has to reach, on the lower step, to show more: the extended top, or `range.hi` if it cannot be extended. */
  extendedTop: number;
  /** The sets the policy recommends: one more than that is what “an extra set” means when the range cannot be extended. */
  recommendedSets: number;
}

/** Whether an exposure shows the person was ready for more at the lower step. */
function showsMore(a: Assessed, opts: FailedRungOptions): boolean {
  const ev = a.ev;
  if (ev.coverage !== 'complete' || ev.performance === 'not_evaluable' || ev.effortMet !== true)
    return false;
  if (opts.extendedTop > opts.range.hi) {
    const amounts = amountOfRequired(a.rec);
    return amounts.length > 0 && amounts.every((x) => x >= opts.extendedTop);
  }
  return ev.performance === 'top_met' && logicalSetCount(a.rec) > opts.recommendedSets;
}

export function failedRungMemory(
  history: readonly Assessed[],
  model: ResistanceModel,
  opts: FailedRungOptions,
): Map<string, FailedRung> {
  const found = new Map<string, FailedRung>();
  // A step is a step only if the model knows it; an exposure with nothing done, or at an unknown
  // setup, does not move the person between steps.
  const used = history.filter((a) => hasData(a) && a.levelId !== null && a.at !== null);
  const harder = (a: Assessed, b: Assessed) => model.compare(a.at!.value, b.at!.value) === 'harder';

  for (let j = 1; j < used.length;) {
    const before = used[j - 1]!;
    const first = used[j]!;
    if (first.levelId === before.levelId || !harder(first, before)) {
      j += 1;
      continue;
    }
    // The run of exposures at the new step.
    let end = j;
    while (end + 1 < used.length && used[end + 1]!.levelId === first.levelId) end += 1;
    const back = used[end + 1];
    const lastAtStep = used[end]!;
    const failures = used.slice(j, end + 1).filter((a) => isFailure(a.ev));
    if (
      back === undefined ||
      !isFailure(lastAtStep.ev) ||
      model.compare(back.at!.value, first.at!.value) !== 'easier'
    ) {
      j = end + 1;
      continue;
    }

    // It failed and the person went back (or was sent back): the step is remembered until it is cleared.
    // Only what comes before the next try of the step counts as clearing it.
    const clearing: Assessed[] = [];
    for (const a of used.slice(end + 1)) {
      if (a.levelId === first.levelId) break;
      if (a.levelId === back.levelId) clearing.push(a);
    }
    const topExposures = clearing.filter((a) => a.ev.performance === 'top_met').length;
    const axisDone = clearing.some((a) => showsMore(a, opts));
    // It fades when a stretch of expiryDays passes without an exposure at either of the two steps.
    const days = [lastAtStep, ...used.slice(end + 1)]
      .filter((a) => a.levelId === first.levelId || a.levelId === back.levelId)
      .map((a) => a.rec.trainingDate);
    const stretches = days.map((d, i) => daysBetween(d, days[i + 1] ?? opts.asOf));
    if (stretches.every((s) => s < opts.expiryDays)) {
      found.set(first.levelId!, {
        level: first.levelId!,
        failedOn: (failures[0] ?? lastAtStep).rec.trainingDate,
        returnedTo: back.levelId!,
        cleared: axisDone,
        clearProgress: { topExposures, axisDone },
      });
    } else {
      found.delete(first.levelId!);
    }
    j = end + 1;
  }
  return found;
}
