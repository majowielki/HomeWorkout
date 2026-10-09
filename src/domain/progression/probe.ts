/**
 * The probe set (engine v2, 03 §15, 13 §16, D28, D33): when the next step
 * up is a big one, or its size is not known, the person first does one set of
 * it, fresh, and the others at the step they know. A whole session below the
 * range to find out that the step is too big is what this avoids; no model of
 * strength is needed, only what happened.
 */

import { effortOf } from '../observations/effort';
import type { ExposureSetRecord } from '../observations/exposure';
import { amountOf, isPerformed, requiredSets } from '../observations/qualify';
import { compareSpecs } from '../resistance/compare';
import type { ResistanceModel, ResistanceSpec } from '../resistance/types';
import { type Assessed, hasData } from './assessed';
import type { ProgressionPolicy } from './policy';

/** How much harder `to` is than `from`, as a fraction, or null when the model cannot say. */
export function relativeStepOf(
  model: ResistanceModel,
  from: ResistanceSpec,
  to: ResistanceSpec,
): number | null {
  return model.relativeStep(from.value, to.value);
}

/** A big step, or one nobody knows the size of, is tried with a probe first. */
export function shouldProbe(
  step: number | null,
  policy: Pick<ProgressionPolicy, 'probeJumpThreshold'>,
): boolean {
  return step === null || step >= policy.probeJumpThreshold;
}

export const isProbe = (s: ExposureSetRecord): boolean => s.planned.role === 'probe';

export type ProbeVerdict = 'passed' | 'failed';

/**
 * What the probe set of an exposure showed, or null when it showed nothing: no probe, not done, done at
 * another resistance than planned, or done to the range without saying how hard it was.
 */
export function probeVerdict(a: Assessed, model: ResistanceModel): ProbeVerdict | null {
  const set = a.rec.sets.find(isProbe);
  if (set === undefined || !isPerformed(set)) return null;
  const seen = set.observation.resistance.value;
  if (seen === null || compareSpecs(seen, set.planned.resistance, model) !== 'equal') return null;
  const amount = amountOf(set.observation);
  const target = set.planned.target;
  const lo =
    target.kind === 'reps' ? target.min : target.kind === 'duration' ? target.minSec : null;
  if (amount === null || lo === null) return null;
  if (amount < lo) return 'failed';
  const asked = set.planned.targetRir;
  if (asked === null) return 'passed';
  const effort = effortOf(set.observation);
  if (effort === null) return null;
  return effort >= asked.min ? 'passed' : 'failed';
}

/**
 * Exposures at the top of the range still needed before the next probe: a probe that failed is not
 * tried again at once (D28). Worked out from the history, so there is nothing to store.
 */
export function probeCooldown(
  history: readonly Assessed[],
  model: ResistanceModel,
  policy: Pick<ProgressionPolicy, 'probeCooldownExposures'>,
): number {
  let passed = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const a = history[i]!;
    if (!hasData(a)) continue;
    if (probeVerdict(a, model) === 'failed') {
      return Math.max(0, policy.probeCooldownExposures - passed);
    }
    if (a.ev.performance === 'top_met') passed += 1;
  }
  return 0;
}

/**
 * How far the person's "to failure" is from failure (D33): the median of what the next exposure at the
 * same resistance achieved beyond what the set before it and its reported reserve implied, for sets
 * reported at or under `maxEffort` reps in reserve. Positive: the person reports "as hard as it gets"
 * with something left. Information for the coach and for the shadow report; no rule reads it.
 */
export function rirBias(
  history: readonly Assessed[],
  model: ResistanceModel,
  policy: Pick<ProgressionPolicy, 'rirBias'>,
): { pairs: number; median: number } | null {
  const used = history.filter(hasData);
  const diffs: number[] = [];
  for (let i = 1; i < used.length; i += 1) {
    const before = used[i - 1]!;
    const after = used[i]!;
    if (compareSpecs(before.at!, after.at!, model) !== 'equal') continue;
    const later = new Map(
      requiredSets(after.rec)
        .filter(isPerformed)
        .map((s) => [`${s.planned.ordinal}${s.planned.side}`, amountOf(s.observation)]),
    );
    for (const s of requiredSets(before.rec).filter(isPerformed)) {
      const effort = effortOf(s.observation);
      const done = amountOf(s.observation);
      const next = later.get(`${s.planned.ordinal}${s.planned.side}`);
      if (effort === null || effort > policy.rirBias.maxEffort || done === null) continue;
      if (typeof next !== 'number') continue;
      diffs.push(next - (done + effort));
    }
  }
  if (diffs.length < policy.rirBias.minPairs) return null;
  diffs.sort((a, b) => a - b);
  const mid = diffs.length >> 1;
  const median = diffs.length % 2 === 1 ? diffs[mid]! : (diffs[mid - 1]! + diffs[mid]!) / 2;
  return { pairs: diffs.length, median };
}
