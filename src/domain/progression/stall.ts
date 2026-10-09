/**
 * Whether an exercise is getting anywhere (engine v2, 03 §9, 13 §17, §19).
 * Three things read it — the reactive deload, the volume lever and the
 * rotation — so what "progress" means is said once: a harder resistance, or
 * more repetitions (seconds) at the same one. A change of setup is a change,
 * not a stall.
 */

import { compareSpecs } from '../resistance/compare';
import type { ResistanceModel } from '../resistance/types';
import { type Assessed, logicalAmounts } from './assessed';

const total = (a: Assessed) => logicalAmounts(a.rec).reduce((sum, x) => sum + x, 0);

/** Whether `cur` is further than `prev`. Both must be exposures with something done. */
export function improved(prev: Assessed, cur: Assessed, model: ResistanceModel): boolean {
  const how = compareSpecs(cur.at!, prev.at!, model);
  return how === 'equal' ? total(cur) > total(prev) : how !== 'easier';
}

/**
 * How many of the latest complete exposures in a row did not improve on the one before. Exposures that
 * are incomplete or from a deload week say nothing and are left out. Zero for a history that is moving.
 */
export function stalledRun(history: readonly Assessed[], model: ResistanceModel): number {
  const complete = history.filter((a) => a.ev.coverage === 'complete' && a.ev.context !== 'deload');
  let run = 0;
  for (let i = complete.length - 1; i > 0; i -= 1) {
    if (improved(complete[i - 1]!, complete[i]!, model)) break;
    run += 1;
  }
  return run;
}

export interface BlockEvidence {
  /** Exposures of the variant in the block that can be judged (complete, comparable, with an effort). */
  qualifiedExposures: number;
  /** The variant is giving progress, or is still being learned. */
  progressing: boolean;
}

/**
 * What a variant has shown in the block that began on `since`. A person who has not done it enough to
 * judge is not stalling (T35); one who is still learning it, or still improving among the latest
 * `window` exposures, is not either.
 */
export function blockEvidence(
  history: readonly Assessed[],
  since: string,
  model: ResistanceModel,
  options: { introExposures: number; window: number },
): BlockEvidence {
  const qualified = history.filter(
    (a) => a.rec.trainingDate >= since && a.ev.performance !== 'not_evaluable',
  );
  const recent = qualified.slice(-options.window);
  const moving = recent.some((a, i) => i > 0 && improved(recent[i - 1]!, a, model));
  return {
    qualifiedExposures: qualified.length,
    progressing: qualified.length <= options.introExposures || moving,
  };
}
