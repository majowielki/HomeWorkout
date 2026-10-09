/**
 * What an exposure is evidence of (engine, 03 §1-§3, 13 §4).
 *
 * Three questions are kept apart so that missing information is never read as
 * a failure or as a success. `qualifyExposure` answers what is *known* about
 * the work — which sets were done, whether the resistance was the planned one,
 * whether the effort was given — and only when that is enough does it say how
 * the work compared with the range. What to prescribe next is another module's
 * question (`progression/next.ts`).
 *
 * Nothing here looks at other exposures: context that needs the history (the
 * first exposures of an exercise, the sessions after a long break) is told to
 * it, not found out.
 */

import type { PlannedSet } from '../plan/plan';
import type { DecisionCode } from '../progression/codes';
import type { ProgressionPolicy } from '../progression/policy';
import { compareSpecs } from '../resistance/compare';
import type { ResistanceModel, ResistanceSpec } from '../resistance/types';
import type { ShortfallReason } from '../types';
import { effortOf } from './effort';
import type { ExposureRecord, ExposureSetRecord } from './exposure';
import type { SetObservation } from './types';

export interface EvidenceAssessment {
  /** Whether every set the plan required has a result. */
  coverage: 'complete' | 'partial' | 'none';
  /**
   * Whether the results are at the resistance that was planned. `reconstructed_exact` is for data that
   * is rebuilt from an older format; the engine starts from nothing and never produces it.
   */
  comparability: 'exact' | 'reconstructed_exact' | 'changed' | 'unknown';
  quality: 'sufficient' | 'missing_rir' | 'unconfirmed' | 'invalid';
  context: 'normal' | 'deload' | 'intro' | 'recalibration' | 'abandoned';
  performance: 'top_met' | 'within_range' | 'below_range' | 'not_evaluable';
  /** Every required set was done with at least the effort the plan asked for; null when that cannot be said. */
  effortMet: boolean | null;
  /** What the person said fell short, anywhere in the exposure: nothing is lost on the way to a code. */
  shortfalls: ShortfallReason[];
  reasons: DecisionCode[];
  requiredSetIds: string[];
  observedSetIds: string[];
}

/** The sets a decision must see done, in the order of the plan. */
export function requiredSets(rec: ExposureRecord): ExposureSetRecord[] {
  return rec.sets
    .filter((s) => s.planned.requiredForProgression)
    .sort(
      (a, b) =>
        a.planned.ordinal - b.planned.ordinal ||
        Number(a.planned.side === 'right') - Number(b.planned.side === 'right'),
    );
}

export function isPerformed(
  s: ExposureSetRecord,
): s is ExposureSetRecord & { observation: SetObservation } {
  return (
    s.disposition === 'performed' && s.observation !== null && s.observation.status === 'performed'
  );
}

/** Reps or seconds of a result, or null for a measure no policy reads yet (distance). */
export function amountOf(o: SetObservation): number | null {
  const q = o.amount.value;
  if (q === null) return null;
  return q.kind === 'reps' ? q.reps : q.kind === 'duration' ? q.seconds : null;
}

/** The range a set was planned with, in the unit of its target; null for a measure no policy reads yet. */
export function rangeOf(planned: PlannedSet): { lo: number; hi: number; target: number } | null {
  const t = planned.target;
  if (t.kind === 'reps') return { lo: t.min, hi: t.max, target: t.target };
  if (t.kind === 'duration') return { lo: t.minSec, hi: t.maxSec, target: t.targetSec };
  return null;
}

/** The amount a result is read as, if it can be read against the plan. */
function readableAmount(s: ExposureSetRecord & { observation: SetObservation }): number | null {
  const q = s.observation.amount.value;
  if (q === null || q.kind !== s.planned.target.kind) return null;
  return amountOf(s.observation);
}

export interface QualifyOptions {
  /** The first exposures of an exercise, or those after a long break: told by the history, not found here. */
  context?: 'intro' | 'recalibration';
}

export function qualifyExposure(
  rec: ExposureRecord,
  policy: Pick<ProgressionPolicy, 'dropOffAllowance'>,
  model: ResistanceModel,
  options: QualifyOptions = {},
): EvidenceAssessment {
  const required = requiredSets(rec);
  const performed = required.filter(isPerformed);
  const reasons: DecisionCode[] = [];
  const add = (code: DecisionCode) => {
    if (!reasons.includes(code)) reasons.push(code);
  };

  // Coverage: every required set, every side. A set without a result is missing whatever the reason.
  const coverage: EvidenceAssessment['coverage'] =
    required.length > 0 && performed.length === required.length
      ? 'complete'
      : performed.length > 0
        ? 'partial'
        : 'none';
  if (coverage !== 'complete') add('INCOMPLETE_PLANNED_SETS');
  if (
    required.some(
      (s) => !isPerformed(s) && (s.planned.side === 'left' || s.planned.side === 'right'),
    )
  ) {
    add('MISSING_SIDE');
  }

  // Comparability: against the plan of each set. A different resistance is a deviation, not a failure.
  let comparability: EvidenceAssessment['comparability'] = 'exact';
  if (performed.length === 0) comparability = 'unknown';
  for (const s of performed) {
    const seen = s.observation.resistance.value;
    if (seen === null) {
      if (comparability === 'exact') comparability = 'unknown';
    } else if (compareSpecs(seen, s.planned.resistance, model) !== 'equal') {
      comparability = 'changed';
    }
  }
  if (comparability === 'changed') add('PRESCRIPTION_DEVIATION');
  if (comparability === 'unknown' && performed.length > 0) add('UNCONFIRMED_ACTUAL');

  // Quality: a result nobody can stand behind, then one without an effort.
  let quality: EvidenceAssessment['quality'] = 'sufficient';
  if (performed.some((s) => readableAmount(s) === null)) quality = 'invalid';
  else if (
    performed.some(
      (s) =>
        s.observation.amount.origin === 'legacy_unknown' ||
        s.observation.resistance.origin === 'legacy_unknown',
    )
  ) {
    quality = 'unconfirmed';
  } else if (performed.some((s) => effortOf(s.observation) === null)) quality = 'missing_rir';
  if (quality === 'invalid' || quality === 'unconfirmed') add('UNCONFIRMED_ACTUAL');
  if (quality === 'missing_rir') add('MISSING_EFFORT_EVIDENCE');

  // What the person said about it: pain anywhere in the exposure, and the confounders of an effort.
  const everything = [
    ...rec.sets.flatMap((s) => (s.observation ? [s.observation] : [])),
    ...rec.extra,
  ];
  const shortfalls = [
    ...new Set(everything.flatMap((o) => (o.shortfall === null ? [] : [o.shortfall]))),
  ].sort();
  if (shortfalls.includes('pain')) add('PAIN_REPORTED');
  if (shortfalls.includes('short_rest') || shortfalls.includes('doms')) add('CONTEXT_CONFOUNDED');
  if (rec.context.userReduced) add('USER_REDUCED');

  const context: EvidenceAssessment['context'] = rec.context.abandoned
    ? 'abandoned'
    : rec.context.deload
      ? 'deload'
      : (options.context ?? 'normal');

  const evaluable =
    coverage === 'complete' &&
    comparability === 'exact' &&
    quality === 'sufficient' &&
    !rec.context.userReduced &&
    context !== 'deload';

  let performance: EvidenceAssessment['performance'] = 'not_evaluable';
  let effortMet: boolean | null = null;
  if (evaluable) {
    // The first logical set must reach the top, the others may fall short of it by the allowance (D30).
    const logical = [...new Set(required.map((s) => s.planned.logicalSetId))];
    const rows = required.map((s) => ({
      amount: readableAmount(s as ExposureSetRecord & { observation: SetObservation })!,
      range: rangeOf(s.planned)!,
      first: s.planned.logicalSetId === logical[0],
    }));
    const top = rows.every((r) => r.amount >= r.range.hi - (r.first ? 0 : policy.dropOffAllowance));
    performance = top
      ? 'top_met'
      : rows.some((r) => r.amount < r.range.lo)
        ? 'below_range'
        : 'within_range';
    effortMet = required.every((s) => {
      const asked = s.planned.targetRir;
      // Quality is sufficient here, so every required set was done and said how hard it was.
      return asked === null || effortOf(s.observation!)! >= asked.min;
    });
  }

  return {
    coverage,
    comparability,
    quality,
    context,
    performance,
    effortMet,
    shortfalls,
    reasons,
    requiredSetIds: required.map((s) => s.planned.id),
    observedSetIds: performed.map((s) => s.planned.id),
  };
}

/** The assessment says the exposure was a failure at its range: complete, exact, ordinary, and below it. */
export function isFailure(ev: EvidenceAssessment): boolean {
  return (
    ev.performance === 'below_range' &&
    ev.context !== 'deload' &&
    ev.context !== 'abandoned' &&
    !ev.shortfalls.includes('pain') &&
    !ev.shortfalls.includes('short_rest') &&
    !ev.shortfalls.includes('doms')
  );
}

/**
 * The resistance the next prescription stands on. Usually the one the sets were done at; when a
 * first exposure was calibrated up or down in the session, the heaviest one at which the sets met
 * their range with the effort asked, else the lightest that was used (13 §8).
 */
export function referenceResistance(
  rec: ExposureRecord,
  model: ResistanceModel,
): ResistanceSpec | null {
  const required = requiredSets(rec);
  const seen = required.filter(isPerformed).flatMap((s) => {
    const spec = s.observation.resistance.value;
    return spec === null ? [] : [{ spec, set: s }];
  });
  if (seen.length === 0) return required[0]?.planned.resistance ?? null;

  const groups: { spec: ResistanceSpec; sets: typeof seen }[] = [];
  for (const entry of seen) {
    const group = groups.find((g) => compareSpecs(g.spec, entry.spec, model) === 'equal');
    if (group) group.sets.push(entry);
    else groups.push({ spec: entry.spec, sets: [entry] });
  }
  if (groups.length === 1) return groups[0]!.spec;

  const met = (g: (typeof groups)[number]) =>
    g.sets.every(({ set }) => {
      const range = rangeOf(set.planned);
      const amount = amountOf(set.observation);
      const asked = set.planned.targetRir;
      return (
        range !== null &&
        amount !== null &&
        amount >= range.lo &&
        (asked === null || (effortOf(set.observation) ?? -1) >= asked.min)
      );
    });
  const heavier = (a: (typeof groups)[number], b: (typeof groups)[number]) =>
    compareSpecs(a.spec, b.spec, model) === 'harder' ? a : b;
  const lighter = (a: (typeof groups)[number], b: (typeof groups)[number]) =>
    compareSpecs(a.spec, b.spec, model) === 'easier' ? a : b;
  const good = groups.filter(met);
  return (good.length > 0 ? good.reduce(heavier) : groups.reduce(lighter)).spec;
}
