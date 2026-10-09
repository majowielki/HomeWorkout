/**
 * Mending a plan the audit did not pass, and planning as a whole (engine v2,
 * 01 §3, 04, T36, T37).
 *
 * The audit only says what is wrong and what could be done about it. Here the
 * mending is done, one explicit step at a time, and after every step the plan is
 * compiled and audited again: nothing is trusted because the step looked
 * harmless. The steps are the ones the audit offers — drop a filler, split a
 * superset, take a set away, drop an exercise — and never a loosened rule: a
 * hard finding or advice nobody confirmed is never waved through. The number of
 * steps is a budget, not a clock.
 *
 * What comes out is one of four: a plan that was fine (`ready`), a plan that is
 * fine after changes that are listed (`adjusted`), no plan that can be made
 * (`no_feasible_plan`), or nothing the engine can handle (`unsupported_input`).
 * An empty day with its reasons is an answer, not an error.
 */

import type { Exercise } from '../types';
import { auditPlan, type AuditContext, type AuditIssue, type RepairKind } from './audit';
import { compileSession, type CompileInput, type ExposureSpec, stampPlan } from './compile';
import { parseExposureId } from './ids';
import type { SessionPlanV2 } from './planV2';
import type { RuleCode } from '../policy/hardAdvice';

export interface PlanChange {
  kind: RepairKind;
  /** The exposure it concerned (its key), or null for the group of a superset. */
  exposureKey: string | null;
  /** The finding it answered. */
  because: RuleCode;
}

export type PlanningResult =
  | { kind: 'ready' | 'adjusted'; plan: SessionPlanV2; changes: PlanChange[]; notes: AuditIssue[] }
  | {
      kind: 'no_feasible_plan' | 'unsupported_input';
      reasons: AuditIssue[];
      changes: PlanChange[];
    };

export interface PlanningOptions {
  /** Advice the person was shown and confirmed (D19). */
  acknowledged?: readonly string[];
  /** The most steps of mending, versioned with the policy. */
  budget?: number;
  /** What the stamp of the plan says it was audited against. */
  snapshotFingerprint: string;
}

export const DEFAULT_REPAIR_BUDGET = 12;

type Specs = readonly ExposureSpec[];

const keyOf = (issue: AuditIssue): string | null =>
  issue.scope.exposureId === undefined
    ? null
    : parseExposureId(issue.scope.exposureId)!.exposureKey;

/** A filler goes first, the last of them first: what was added to fill the day is what the day can do without. */
function dropFiller(specs: Specs): { specs: Specs; key: string } | null {
  const filler = [...specs].reverse().find((s) => s.filler === true);
  return filler === undefined
    ? null
    : { specs: specs.filter((s) => s !== filler), key: filler.key };
}

/** The members of a superset are done one after the other instead of round by round. */
function splitSuperset(
  specs: Specs,
  issue: AuditIssue,
  plan: SessionPlanV2,
): { specs: Specs; key: string | null } | null {
  const named = keyOf(issue);
  const own = specs.find((s) => s.key === named)?.group ?? null;
  // Without a particular exposure: the first superset that has a changeover in it.
  const setups = new Set(
    plan.execution.steps.flatMap((step, i) => {
      const after = plan.execution.steps[i + 1];
      return step.kind === 'setup' && after?.kind === 'perform' ? [after.plannedSetId] : [];
    }),
  );
  const inSetup = plan.exposures.find((e) => e.sets.some((s) => setups.has(s.id)));
  const key = inSetup === undefined ? undefined : parseExposureId(inSetup.id)!.exposureKey;
  const group = own ?? specs.find((s) => s.key === key)?.group ?? null;
  if (group === null || specs.filter((s) => s.group === group).length < 2) return null;
  return { specs: specs.map((s) => (s.group === group ? { ...s, group: null } : s)), key: null };
}

/** The exposure that can give up a set: the one with the most sets that trains the muscle, the later in the plan the sooner. */
function reduceSets(
  specs: Specs,
  issue: AuditIssue,
  catalog: Readonly<Record<string, Exercise>>,
): { specs: Specs; key: string } | null {
  const muscle = issue.data.muscle;
  const named = keyOf(issue);
  const candidates = specs.filter(
    (s) =>
      s.sets.length > 1 &&
      (named !== null
        ? s.key === named
        : typeof muscle === 'string'
          ? catalog[s.exercise.id]?.primaryMuscles.includes(muscle as never) === true
          : true),
  );
  const target = [...candidates].reverse().sort((a, b) => b.sets.length - a.sets.length)[0];
  if (target === undefined) return null;
  // The last set goes; a probe is the first and stays.
  const sets = target.sets.slice(0, -1);
  return { specs: specs.map((s) => (s === target ? { ...s, sets } : s)), key: target.key };
}

/** The exposure goes: the one the finding is about, or the last that trains the muscle, or the last. */
function dropExposure(
  specs: Specs,
  issue: AuditIssue,
  catalog: Readonly<Record<string, Exercise>>,
): { specs: Specs; key: string } | null {
  const muscle = issue.data.muscle;
  const named = keyOf(issue);
  const pool = specs.filter((s) =>
    named !== null
      ? s.key === named
      : typeof muscle === 'string'
        ? catalog[s.exercise.id]?.primaryMuscles.includes(muscle as never) === true
        : true,
  );
  // The finding came from an exposure of the plan, so there is one to drop.
  const target = pool[pool.length - 1]!;
  return { specs: specs.filter((s) => s !== target), key: target.key };
}

/** One step of mending for the first finding that has one to offer, or null. */
function mend(
  specs: Specs,
  issues: readonly AuditIssue[],
  plan: SessionPlanV2,
  catalog: Readonly<Record<string, Exercise>>,
): { specs: Specs; change: PlanChange } | null {
  for (const issue of issues) {
    for (const kind of issue.repairs) {
      const done =
        kind === 'drop_filler'
          ? dropFiller(specs)
          : kind === 'split_superset'
            ? splitSuperset(specs, issue, plan)
            : kind === 'reduce_sets'
              ? reduceSets(specs, issue, catalog)
              : dropExposure(specs, issue, catalog);
      if (done !== null) {
        return { specs: done.specs, change: { kind, exposureKey: done.key, because: issue.code } };
      }
    }
  }
  return null;
}

const uniq = (issues: readonly AuditIssue[]): AuditIssue[] => {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.code}|${i.scope.exposureId ?? ''}|${i.scope.plannedSetId ?? ''}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
};

/**
 * Plans from recipes: compile, audit, and mend until the plan passes or the budget or the ways to
 * mend it are used up. `input.exposures` is ignored; `specs` are the recipes in the order of the day,
 * the ones the planner wanted most first.
 */
export function planWithRepair(
  specs: Specs,
  input: Omit<CompileInput, 'exposures'>,
  ctx: AuditContext,
  options: PlanningOptions,
): PlanningResult {
  const acknowledged = options.acknowledged ?? [];
  let budget = options.budget ?? DEFAULT_REPAIR_BUDGET;
  let current = specs;
  const changes: PlanChange[] = [];
  const reasons: AuditIssue[] = [];

  for (;;) {
    const plan = stampPlan(compileSession({ ...input, exposures: current }), {
      mode: ctx.mode,
      snapshotFingerprint: options.snapshotFingerprint,
      overrides: [...acknowledged],
    });
    const audit = auditPlan(plan, ctx, acknowledged);
    if (audit.kind === 'valid' && current.length > 0) {
      return {
        kind: changes.length === 0 ? 'ready' : 'adjusted',
        plan,
        changes,
        notes: audit.notes,
      };
    }
    const issues = audit.kind === 'invalid' ? audit.issues : [];
    const step = budget > 0 ? mend(current, issues, plan, ctx.catalog) : null;
    if (step === null) {
      // Nothing is left to mend with, or nothing to mend: the day has no plan, and says why.
      const why = uniq([...reasons, ...issues]);
      const unsupported =
        why.length > 0 &&
        why.every((i) => i.code === 'PLAN_INVALID' || i.code === 'UNSUPPORTED_CAPABILITY');
      return {
        kind: unsupported ? 'unsupported_input' : 'no_feasible_plan',
        reasons: why,
        changes,
      };
    }
    reasons.push(...issues.filter((i) => step.change.because === i.code));
    changes.push(step.change);
    current = step.specs;
    budget -= 1;
  }
}
