/**
 * The rules of the progression pipeline (engine, 03 §4-§6, §12-§17, 13 §5).
 *
 * Each rule reads the history, the draft the earlier rules left and the
 * context, and either leaves the draft alone or settles it. A rule that
 * settles the prescription says `final`, and nothing after it may change what
 * it settled; the rules marked `always` still run, for what does not depend on
 * the decision (the effort of a deload week, the number of sets, the check of
 * the result). The order is the priority of 03 §4: safety and eligibility,
 * then what is known, then what the person did.
 */

import { daysBetween } from '../time/trainingDate';
import { requiredSets, rangeOf, isFailure, isPerformed } from '../observations/qualify';
import type { ExposureRecord } from '../observations/exposure';
import { type Assessed, logicalResults } from './assessed';
import { chooseIntermediateAxis } from './axes';
import { buildUpState, buildUpTargets, shouldSuggestVariantDown } from './buildUp';
import { withCode, type Draft, type Rule, type RuleCtx } from './draft';
import { levelIdOf, nextEasierSpec, nextHarderSpec } from './levels';
import { isProbe, probeVerdict, relativeStepOf, shouldProbe, workedAtProbeStep } from './probe';
import { BLOCK_CONFIG } from '../config/training';
import type { DecisionCode } from './codes';
import type { ResistanceSpec } from '../resistance/types';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** `n` working sets with the same target. */
const filled = (ctx: RuleCtx, value: number) =>
  Array.from({ length: Math.max(1, ctx.sets.recommended) }, () => value);

/** What the plan of the exposure asked of each logical set. */
function plannedTargets(rec: ExposureRecord): number[] {
  const seen = new Map<string, number>();
  for (const s of requiredSets(rec)) {
    const range = rangeOf(s.planned);
    if (range !== null && !seen.has(s.planned.logicalSetId)) {
      seen.set(s.planned.logicalSetId, range.target);
    }
  }
  return [...seen.values()];
}

/** What the plan of the exposure asked in reserve: the least over its required sets, none if it asked none. */
function askedRir(rec: ExposureRecord): number {
  const asked = requiredSets(rec).flatMap((s) =>
    s.planned.targetRir ? [s.planned.targetRir.min] : [],
  );
  return asked.length === 0 ? 0 : Math.min(...asked);
}

/** The top of the range as the last exposure carried it: kept only while an extension is what the plan is doing. */
function holdHi(ctx: RuleCtx, a: Assessed, extension: boolean): number {
  return extension && a.planned !== null ? Math.max(ctx.range.hi, a.planned.hi) : ctx.range.hi;
}

/** Whether the range is being extended now: at the ceiling, while a step is remembered as failed, or after a failed probe. */
function extensionActive(ctx: RuleCtx, a: Assessed): boolean {
  const next = nextHarderSpec(ctx.model, a.at!);
  if (next === null || ctx.probeCooldown > 0) return true;
  const failed = ctx.failed.get(levelIdOf(ctx.model, next)!);
  return failed !== undefined && !failed.cleared;
}

/** Repeat the exposure’s recipe at the resistance it was done at. */
function holdAt(
  ctx: RuleCtx,
  d: Draft,
  a: Assessed,
  codes: DecisionCode[],
  decision: string,
  targets: number[] = plannedTargets(a.rec),
): Draft {
  const hi = holdHi(ctx, a, extensionActive(ctx, a));
  return {
    ...d,
    resistance: a.at,
    targets: targets.map((t) => Math.min(t, hi)),
    range: { lo: ctx.range.lo, hi },
    codes: withCode(d, ...codes),
    decision,
    evidence: { ...d.evidence, exposureId: a.rec.exposureId },
    final: true,
  };
}

/** What the person did, set for set, clamped into the range: the recipe of "do again what you did". */
function repeatTargets(ctx: RuleCtx, a: Assessed): number[] {
  const hi = holdHi(ctx, a, extensionActive(ctx, a));
  return logicalResults(a.rec).map((r) => clamp(r.amount, ctx.range.lo, hi));
}

/** What the phase has to say, kept apart so that the code of the decision stays first. */
const note = (d: Draft, ...codes: DecisionCode[]): Draft => ({
  ...d,
  notes: [...d.notes, ...codes.filter((c) => !d.notes.includes(c))],
});

const nonDeload = (ctx: RuleCtx) => ctx.usable.filter((a) => a.ev.context !== 'deload');

/** A resistance harder than the draft allows (a deload, the sessions after a long break). */
function blocked(ctx: RuleCtx, d: Draft, to: ResistanceSpec): boolean {
  return d.maxHarder !== null && ctx.model.compare(to.value, d.maxHarder.value) === 'harder';
}

// --------------------------------------------------------------------- rules

/** 1. Nothing is prescribed for what may not be planned, or counted in what the model cannot count. */
export const eligibilityRule: Rule = {
  id: 'eligibility',
  apply(ctx, d) {
    if (!ctx.model.capabilities.quantityKinds.includes(ctx.unit)) {
      return { ...d, codes: withCode(d, 'MODEL_NOT_APPLICABLE'), decision: 'none', final: true };
    }
    if (!ctx.eligible) {
      return { ...d, codes: withCode(d, 'NOT_PRESCRIBED'), decision: 'none', final: true };
    }
    return d;
  },
};

/** 2. Pain in the last exposure: no step in either direction, and the work goes to the workflow of restrictions. */
export const painRule: Rule = {
  id: 'pain',
  apply(ctx, d) {
    const last = ctx.last;
    if (d.final || last === null || !last.ev.shortfalls.includes('pain')) return d;
    return {
      ...holdAt(ctx, d, last, ['PAIN_REPORTED'], 'hold'),
      maxHarder: last.at,
    };
  },
};

/** 3. Nothing done before on this setup: the start of the slot, at the bottom of the range, with room to learn. */
export const firstExposureRule: Rule = {
  id: 'first_exposure',
  apply(ctx, d) {
    if (d.final || ctx.usable.length > 0) return d;
    if (ctx.start === null) {
      return { ...d, codes: withCode(d, 'NOT_PRESCRIBED'), decision: 'none', final: true };
    }
    return {
      ...d,
      resistance: ctx.start,
      targets: filled(ctx, ctx.range.lo),
      targetRir: { min: ctx.policy.introRir, max: ctx.policy.introRir },
      axis: 'calibration',
      codes: withCode(d, 'FIRST_COMPARABLE_EXPOSURE'),
      decision: 'start',
      confidence: 'low',
      final: true,
    };
  },
};

/**
 * 4. Coming back. Worked out from the last exposure that was really done, so planning twice from the
 * same history gives the same answer and a long break is paid for once (T33). Two clocks: the exercise
 * not done for a month (it may have been rotated out), and a break from training altogether.
 */
export const returnRule: Rule = {
  id: 'return',
  apply(ctx, d) {
    const last = ctx.last;
    if (d.final || last === null) return d;
    const at = last.at!;
    const gapDays = daysBetween(last.rec.trainingDate, ctx.asOf);
    const clock = ctx.layoff.tier === 'none' ? 'exercise' : 'global';
    const evidence = { ...d.evidence, exposureId: last.rec.exposureId, gapDays, clock };
    const lo = ctx.range.lo;

    if (gapDays >= ctx.policy.reExposureAfterDays) {
      const easier = nextEasierSpec(ctx.model, at);
      return {
        ...d,
        resistance: easier ?? at,
        targets: filled(ctx, lo),
        targetRir: { min: ctx.policy.introRir, max: ctx.policy.introRir },
        codes: withCode(d, 'RE_EXPOSURE'),
        decision: 'return',
        confidence: 'low',
        evidence,
        final: true,
      };
    }
    if (ctx.layoff.tier === 'short') {
      return {
        ...d,
        resistance: at,
        targets: repeatTargets(ctx, last),
        codes: withCode(d, 'LAYOFF_REPEAT'),
        decision: 'return',
        evidence,
        final: true,
      };
    }
    if (ctx.layoff.tier === 'medium') {
      const easier = nextEasierSpec(ctx.model, at);
      return {
        ...d,
        resistance: easier ?? at,
        targets: filled(ctx, lo),
        codes: withCode(d, easier === null ? 'LAYOFF_REPEAT' : 'LAYOFF_STEP_DOWN'),
        decision: 'return',
        evidence,
        final: true,
      };
    }
    return d;
  },
};

/** 5. The phase: a deload week repeats the last recipe at half the sets and easy effort; the first sessions after a long break are easy and do not go up. */
export const phaseRule: Rule = {
  id: 'phase',
  always: true,
  apply(ctx, d) {
    let out = d;
    const last = ctx.last;
    if (ctx.phase === 'deload') {
      // There is a last exposure: with none, the first-exposure rule settled the draft.
      if (!out.final) {
        out = holdAt(ctx, out, last!, ['DELOAD'], 'deload', repeatTargets(ctx, last!));
      } else {
        out = note(out, 'DELOAD');
      }
      return {
        ...out,
        targetRir: { min: BLOCK_CONFIG.deloadRir[0], max: BLOCK_CONFIG.deloadRir[1] },
        maxHarder: out.resistance,
      };
    }
    if (last === null) return out;
    if (ctx.layoff.recalibrating) {
      return {
        ...note(out, 'RECALIBRATION'),
        targetRir: { min: ctx.policy.introRir, max: ctx.policy.introRir },
        maxHarder: out.resistance ?? last.at,
      };
    }
    if (ctx.usable.length < ctx.policy.introExposures) {
      return {
        ...note(out, 'INTRO_EXPOSURE'),
        targetRir: { min: ctx.policy.introRir, max: ctx.policy.introRir },
        confidence: 'low',
      };
    }
    return out;
  },
};

/**
 * 5b. A probe set, judged on its own (03 §15). Passed: the whole exposure moves to the step it was done
 * at. Failed: noted, and the work sets are judged as always; the probe is never counted as a failure.
 */
export const probeOutcomeRule: Rule = {
  id: 'probe_outcome',
  apply(ctx, d) {
    const a = ctx.base;
    if (d.final || a === null) return d;
    const verdict = probeVerdict(a, ctx.model);
    if (verdict === null) return d;
    if (verdict === 'failed') {
      return {
        ...d,
        codes: withCode(d, 'PROBE_FAILED'),
        evidence: { ...d.evidence, probe: 'failed' },
      };
    }
    const ev = a.ev;
    // The work sets done at the step of the probe are the person's own step up: it is neither a changed
    // setup nor a failure to reach the range of a step that was only just reached.
    const own = workedAtProbeStep(a, ctx.model);
    const doubtful =
      (!own && (ev.comparability === 'changed' || ev.performance === 'below_range')) ||
      ev.reasons.includes('CONTEXT_CONFOUNDED') ||
      ev.reasons.includes('USER_REDUCED');
    const to = a.rec.sets.find(isProbe)!.planned.resistance;
    if (doubtful || blocked(ctx, d, to)) return d;
    return {
      ...d,
      resistance: to,
      targets: filled(ctx, ctx.range.lo),
      range: { ...ctx.range },
      codes: withCode(d, 'PROBE_PASSED'),
      decision: 'advance',
      evidence: { ...d.evidence, exposureId: a.rec.exposureId, probe: 'passed' },
      final: true,
    };
  },
};

/** 6. What is not known is not a failure and not a success: hold, and say what is missing (03 §5). */
export const evidenceRule: Rule = {
  id: 'evidence',
  apply(ctx, d) {
    const a = ctx.base;
    const unsure =
      a !== null &&
      (a.ev.performance === 'not_evaluable' || a.ev.reasons.includes('CONTEXT_CONFOUNDED'));
    if (d.final || a === null || !unsure) return d;
    const missing = a.ev.reasons.filter((r) => r !== 'PAIN_REPORTED');
    const codes: DecisionCode[] = missing.length > 0 ? missing : ['CONTEXT_CONFOUNDED'];
    if (a.rec.context.feel === 'too_hard') codes.push('FEEL_TOO_HARD');
    // At another resistance than planned, the recipe to repeat is what was done, not what was meant.
    const targets =
      a.ev.comparability === 'changed' ? repeatTargets(ctx, a) : plannedTargets(a.rec);
    return holdAt(ctx, d, a, codes, 'hold', targets);
  },
};

/** 7. Failures that count: complete, comparable, in an ordinary context, at one step and one range, in a row. */
export const failureRule: Rule = {
  id: 'failure',
  apply(ctx, d) {
    const base = ctx.base;
    const n = ctx.policy.failuresToRegress;
    const tail = ctx.steps.slice(-n);
    if (d.final || base === null || tail.length < n || tail[n - 1] !== base) return d;
    const first = tail[0]!;
    const together = tail.every(
      (a) =>
        isFailure(a.ev) &&
        a.levelId !== null &&
        a.levelId === first.levelId &&
        a.planned?.lo === first.planned?.lo,
    );
    const easier = together ? nextEasierSpec(ctx.model, base.at!) : null;
    if (easier === null) return d;
    return {
      ...d,
      resistance: easier,
      targets: filled(ctx, ctx.range.lo),
      range: { ...ctx.range },
      codes: withCode(d, 'LOAD_STEP_DOWN'),
      decision: 'regress',
      evidence: { ...d.evidence, exposureId: base.rec.exposureId, failures: n },
      final: true,
    };
  },
};

/** 7a. Where nothing is easier, build from what the person did (D39). */
export const buildUpRule: Rule = {
  id: 'build_up',
  apply(ctx, d) {
    const base = ctx.base;
    if (d.final || base === null || ctx.model.nextEasier(base.at!.value) !== null) return d;
    const deferredAt = ctx.user?.variantDownDeferredAt;
    const state = buildUpState(ctx.steps, ctx.model, ctx.range, deferredAt);
    if (!state.active) return d;
    let out: Draft = {
      ...d,
      resistance: base.at,
      targets: buildUpTargets(base.rec, ctx.range, ctx.step, ctx.targetRir.min, ctx.minAmount),
      range: { ...ctx.range },
      codes: withCode(d, 'AT_MINIMUM', 'BUILDUP_BELOW_RANGE'),
      decision: 'build_up',
      evidence: {
        ...d.evidence,
        exposureId: base.rec.exposureId,
        stalledExposures: state.stalledExposures,
        best: state.bestRequired,
      },
      final: true,
    };
    if (shouldSuggestVariantDown(state, ctx.range.lo, ctx.policy, deferredAt !== undefined)) {
      const to = ctx.variants?.easier ?? null;
      out =
        to === null
          ? { ...out, codes: withCode(out, 'NO_EASIER_VARIANT') }
          : {
              ...out,
              proposals: [
                ...out.proposals,
                { kind: 'variant_down', to, code: 'VARIANT_DOWN_SUGGESTED' },
              ],
              codes: withCode(out, 'VARIANT_DOWN_SUGGESTED'),
            };
    }
    return out;
  },
};

/** Untouched suggestions only: the person may be saving what they were shown without looking (D20). */
function isAutopilot(a: Assessed): boolean {
  return requiredSets(a.rec)
    .filter(isPerformed)
    .every((s) => s.observation.amount.presentedDefault && s.observation.rir.presentedDefault);
}

/** 8. The whole exposure at the top of the range, with the effort asked: a step up, tried carefully. */
export const successRule: Rule = {
  id: 'success',
  apply(ctx, d) {
    const a = ctx.base;
    if (d.final || a === null || a.ev.performance !== 'top_met') return d;
    const cur = a.at!;
    const hi = a.planned!.hi;
    const feel = a.rec.context.feel;
    const evidence = { ...d.evidence, exposureId: a.rec.exposureId };
    const hold = (codes: DecisionCode[], extra: Partial<Draft> = {}): Draft => ({
      ...d,
      resistance: cur,
      targets: filled(ctx, hi),
      range: { lo: ctx.range.lo, hi },
      codes: withCode(d, ...codes),
      decision: 'hold',
      evidence,
      final: true,
      ...extra,
    });
    /** Something between "hold" and "step up"; `addSet` is for failed steps, not for the ceiling. */
    const between = (codes: DecisionCode[], addSet: boolean): Draft => {
      const policy = addSet
        ? ctx.policy
        : { ...ctx.policy, axes: { ...ctx.policy.axes, addSet: false } };
      const choice = chooseIntermediateAxis({
        policy,
        unit: ctx.unit,
        baseHi: ctx.range.hi,
        currentHi: hi,
        repCap: ctx.repCap,
        recommendedSets: ctx.sets.recommended,
        allowedSets: ctx.sets.allowed?.[1] ?? 0,
        pace: feel === 'too_easy' ? 2 : 1,
      });
      return hold(codes, {
        targets: Array.from({ length: Math.max(1, choice.sets) }, () => choice.hi),
        range: { lo: ctx.range.lo, hi: choice.hi },
        sets: choice.sets,
        axis: choice.axis === 'hold' ? 'none' : choice.axis,
      });
    };

    if (a.ev.effortMet === false) return hold(['RIR_TOO_LOW']);
    if (feel === 'too_hard') return hold(['FEEL_TOO_HARD']);

    const next = nextHarderSpec(ctx.model, cur);
    if (next === null) {
      // The top of the ladder: stay, lengthen the range up to its cap, then a harder variant (D34).
      const out = between(['LOAD_CEILING'], false);
      const capped = ctx.unit === 'reps' && out.range.hi >= ctx.extendedTop;
      const sameLevel = nonDeload(ctx).slice(-ctx.policy.variantUpTopExposures);
      const streak =
        sameLevel.length === ctx.policy.variantUpTopExposures &&
        sameLevel.every((x) => x.ev.performance === 'top_met' && x.levelId === a.levelId);
      const codes: DecisionCode[] = capped ? ['REP_CAP_REACHED'] : [];
      const harder = ctx.variants?.harder ?? null;
      if (harder !== null && (capped || streak)) {
        return {
          ...out,
          codes: withCode(out, ...codes, 'VARIANT_UP_SUGGESTED'),
          proposals: [
            ...out.proposals,
            { kind: 'variant_up', to: harder, code: 'VARIANT_UP_SUGGESTED' },
          ],
        };
      }
      return { ...out, codes: withCode(out, ...codes) };
    }
    if (blocked(ctx, d, next)) return hold([]);

    const failed = ctx.failed.get(levelIdOf(ctx.model, next)!);
    if (failed !== undefined && !failed.cleared) return between(['RUNG_RECENTLY_FAILED'], true);

    // Two exposures made only of untouched suggestions: ask before a step up (D20).
    const recent = nonDeload(ctx).slice(-ctx.policy.autopilotExposures);
    const unattended = recent.length === ctx.policy.autopilotExposures && recent.every(isAutopilot);
    if (unattended && ctx.user?.stepUp !== 'yes') {
      if (ctx.user?.stepUp === 'no') return hold(['USER_DEFERRED']);
      return hold(['CONFIRM_STEP_UP'], {
        proposals: [...d.proposals, { kind: 'confirm_step_up', to: next, code: 'CONFIRM_STEP_UP' }],
      });
    }

    const fresh = feel === 'too_easy' ? (['FEEL_TOO_EASY'] as DecisionCode[]) : [];
    if (shouldProbe(relativeStepOf(ctx.model, cur, next), ctx.policy)) {
      if (ctx.probeCooldown > 0) return between(['PROBE_COOLDOWN', ...fresh], false);
      if ((ctx.sets.allowed?.[1] ?? 0) < 2) return hold(['NO_ROOM_FOR_PROBE']);
      return hold(['PROBE_PLANNED', ...fresh], {
        probe: { resistance: next, target: ctx.range.lo },
        decision: 'probe',
      });
    }
    return {
      ...d,
      resistance: next,
      targets: filled(ctx, ctx.range.lo),
      range: { ...ctx.range },
      codes: withCode(d, 'LOAD_STEP_UP', ...fresh),
      decision: 'advance',
      evidence,
      final: true,
    };
  },
};

/** 9. Inside the range, or under it once: the same resistance and a little more, set for set (03 §5). */
export const repProgressionRule: Rule = {
  id: 'rep_progression',
  apply(ctx, d) {
    const a = ctx.base;
    if (d.final || a === null) return d;
    const hi = holdHi(ctx, a, extensionActive(ctx, a));
    const asked = askedRir(a.rec);
    const tooEasy = a.rec.context.feel === 'too_easy';
    const growth = ctx.step * (tooEasy ? 2 : 1);
    // A set that took everything is repeated: it is not asked for more, and not for less.
    const targets = logicalResults(a.rec).map((r) =>
      r.effort !== null && r.effort < asked
        ? clamp(r.amount, ctx.range.lo, hi)
        : clamp(r.amount + growth, ctx.range.lo, hi),
    );
    return {
      ...d,
      resistance: a.at,
      targets,
      range: { lo: ctx.range.lo, hi },
      codes: withCode(
        d,
        'REP_PROGRESSION',
        ...(tooEasy ? (['FEEL_TOO_EASY'] as DecisionCode[]) : []),
      ),
      decision: 'hold',
      evidence: { ...d.evidence, exposureId: a.rec.exposureId },
      final: true,
    };
  },
};

/** 10. A model of strength, if there is one, writes what it thinks into the trace and changes nothing (03 §7). */
export const estimatorShadowRule: Rule = {
  id: 'estimator_shadow',
  always: true,
  apply(ctx, d) {
    if (ctx.estimator === undefined) return d;
    return { ...d, evidence: { ...d.evidence, shadow: ctx.estimator(ctx) } };
  },
};

/** 11. How many sets: what the policy recommends, or what an axis asked for; a probe takes one of them. */
export const setsRule: Rule = {
  id: 'sets',
  always: true,
  apply(ctx, d) {
    const total = d.sets ?? ctx.sets.recommended;
    const work = d.probe === null ? total : Math.max(total, 2) - 1;
    return { ...d, sets: work, evidence: { ...d.evidence, setsReasons: ctx.sets.reasons } };
  },
};

/** 12. The last check: the resistance is a step of the model, and a target is a number the data can hold. */
export const normalizeRule: Rule = {
  id: 'normalize',
  always: true,
  apply(ctx, d) {
    let out = d;
    if (out.resistance !== null && !ctx.model.validate(out.resistance.value).ok) {
      out = { ...out, resistance: null, codes: withCode(out, 'MODEL_NOT_APPLICABLE') };
    }
    if (out.probe !== null && !ctx.model.validate(out.probe.resistance.value).ok) {
      out = { ...out, probe: null };
    }
    const cap = ctx.unit === 'reps' ? Math.max(out.range.hi, ctx.repCap) : out.range.hi;
    const sets = out.resistance === null ? 0 : (out.sets ?? 0);
    const targets = Array.from({ length: sets }, (_, i) =>
      clamp(out.targets[i] ?? out.targets.at(-1) ?? ctx.range.lo, ctx.minAmount, cap),
    );
    return {
      ...out,
      sets,
      targets,
      targetRir: out.targetRir ?? ctx.targetRir,
      codes: withCode(out, ...out.notes),
      notes: [],
    };
  },
};
