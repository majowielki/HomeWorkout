/**
 * What the next exposure of an exercise should be (engine, 13 §5).
 *
 * `prescribeNext` reads the primary exposures of one exercise on one setup,
 * works out what each is evidence of, and runs the rules of `PIPELINE` in
 * their order over one draft. Pure: the same history and the same context give
 * the same draft and the same trace, whatever order the records came in (T56).
 * The draft says what to do and why; turning it into the sets of a plan, with
 * their ids, times and steps, is the compiler’s work.
 */

import { compareCodePoints } from '../fingerprint';
import type { DecisionTrace } from '../plan/plan';
import { assess } from './assessed';
import { extendedTop } from './axes';
import { emptyDraft, type Draft, type NextInput, type Rule, type RuleCtx } from './draft';
import { failedRungMemory } from './failedRungs';
import { levelIdOf } from './levels';
import { DEFAULT_PROGRESSION_POLICY } from './policy';
import { probeCooldown } from './probe';
import {
  buildUpRule,
  eligibilityRule,
  estimatorShadowRule,
  evidenceRule,
  failureRule,
  firstExposureRule,
  normalizeRule,
  painRule,
  phaseRule,
  probeOutcomeRule,
  repProgressionRule,
  returnRule,
  setsRule,
  successRule,
} from './rules';

export const PIPELINE: readonly Rule[] = [
  eligibilityRule,
  painRule,
  firstExposureRule,
  returnRule,
  phaseRule,
  probeOutcomeRule,
  evidenceRule,
  failureRule,
  buildUpRule,
  successRule,
  repProgressionRule,
  estimatorShadowRule,
  setsRule,
  normalizeRule,
];

/** Everything the rules read, worked out once from the input. */
export function contextOf(input: NextInput): RuleCtx {
  const policy = input.policy ?? DEFAULT_PROGRESSION_POLICY;
  const ordered = [...input.history].sort(
    (a, b) =>
      compareCodePoints(a.trainingDate, b.trainingDate) ||
      compareCodePoints(a.exposureId, b.exposureId),
  );
  const steps = assess(ordered, policy, input.model);
  const usable = steps.filter((a) => a.ev.coverage !== 'none');
  const last = usable[usable.length - 1] ?? null;
  const base = [...usable].reverse().find((a) => a.ev.context !== 'deload') ?? last;
  const top = extendedTop(policy, input.unit, input.range.hi, input.repCap);
  return {
    ...input,
    policy,
    steps,
    usable,
    last,
    base,
    failed: failedRungMemory(steps, input.model, {
      asOf: input.asOf,
      expiryDays: policy.failedRungExpiryDays,
      range: input.range,
      extendedTop: top,
    }),
    step: policy.step[input.unit],
    minAmount: policy.minAmount[input.unit],
    extendedTop: top,
    probeCooldown: probeCooldown(steps, input.model, policy),
  };
}

/** What a draft looks like to the trace: enough to see that a rule changed something. */
const shape = (d: Draft) =>
  JSON.stringify([
    d.resistance?.value ?? null,
    d.targets,
    d.range,
    d.sets,
    d.targetRir,
    d.maxHarder?.value ?? null,
    d.axis,
    d.probe?.resistance.value ?? null,
    d.proposals,
    d.codes,
    d.notes,
    d.decision,
    d.final,
  ]);

export interface Prescribed {
  draft: Draft;
  trace: DecisionTrace;
}

export function prescribeNext(input: NextInput, pipeline: readonly Rule[] = PIPELINE): Prescribed {
  const ctx = contextOf(input);
  let draft = emptyDraft(ctx);
  const applied: { rule: string; codes: string[]; final: boolean }[] = [];
  for (const rule of pipeline) {
    if (draft.final && rule.always !== true) continue;
    const before = shape(draft);
    const after = rule.apply(ctx, draft);
    if (shape(after) !== before) {
      applied.push({
        rule: rule.id,
        codes: after.codes.filter((c) => !draft.codes.includes(c)),
        final: after.final,
      });
    }
    draft = after;
  }
  const base = ctx.base;
  return {
    draft,
    trace: {
      schemaVersion: 1,
      decision: draft.decision,
      // Every settled draft carries a code; the pipeline's tests walk the cases to prove it.
      code: draft.codes[0]!,
      policy: { id: ctx.policy.id, version: ctx.policy.version },
      evidence: {
        ...draft.evidence,
        exposureId: base?.rec.exposureId ?? null,
        level: base?.at ? levelIdOf(ctx.model, base.at) : null,
        exposures: ctx.usable.length,
        codes: draft.codes,
        axis: draft.axis,
        confidence: draft.confidence,
        rules: applied,
      },
      estimate: null,
    },
  };
}
