/**
 * The one authority on whether a plan may be run (engine v2, 01 §5, 04, 12 §2).
 *
 * Every way a plan can come about — the engine, a template, the coach, an extra
 * session, a change in the middle of a session — is audited here and nowhere
 * else, so the same plan gets the same verdict wherever it came from (T07).
 * The audit is pure and changes nothing; mending a plan is `repair.ts`.
 *
 * Findings carry the class of their rule from `policy/hardAdvice.ts`. A plan
 * made by the engine has no finding that fails. A plan the person asked for may
 * have failing *advice* (volume, recovery, time) when they were shown it and
 * confirmed it (`acknowledged`, D19); a failing hard rule never passes.
 */

import { compareCodePoints, fingerprintWithout } from '../fingerprint';
import { PLANNER_CONFIG, TECHNICAL_LIMITS, TRAINING_CONFIG } from '../config/training';
import { ineligibility, type EligibilityContext } from './eligibility';
import { type AssessmentCheck, finding, type RuleCode, type CheckData } from '../policy/hardAdvice';
import { PROGRESSION_POLICIES } from '../policy/registry';
import { DECISION_CODES } from '../progression/codes';
import type { Avoided } from './constraints';
import { isAvoided } from './constraints';
import {
  type AUDIT_MODES,
  type PlannedExposure,
  type PlannedSet,
  type SessionPlanV2,
  sessionPlanV2Schema,
} from './planV2';
import type { ResistanceModel, ResistanceSpec } from '../resistance/types';
import type { Exercise, MuscleGroup } from '../types';
import { countsAsVolume } from '../volume/weekly';

export type AuditMode = (typeof AUDIT_MODES)[number];

/** The ways a plan can be mended, so that a finding says what could be done about it (01 §3). */
export type RepairKind = 'drop_filler' | 'split_superset' | 'reduce_sets' | 'drop_exposure';

export interface AuditScope {
  level: 'session' | 'exposure' | 'set' | 'step';
  exposureId?: string;
  plannedSetId?: string;
}

export interface AuditIssue extends AssessmentCheck {
  scope: AuditScope;
  repairs: RepairKind[];
}

export type AuditResult =
  | { kind: 'valid'; planHash: string; notes: AuditIssue[] }
  | { kind: 'invalid'; issues: AuditIssue[]; notes: AuditIssue[] };

/** The state of the day a plan is audited against. */
export interface AuditDay {
  /** The training day the plan is for. */
  date: string;
  /** A rest day in the week: no plan of the engine's. */
  restDay: boolean;
  avoided: Avoided;
  /** Muscles that hurt today (a reported pain). */
  painMuscles: ReadonlySet<MuscleGroup>;
  isSore: (exercise: Exercise) => boolean;
  isRecovering: (exercise: Exercise) => boolean;
  /** Direct sets each muscle already got today, from other sessions of the day. */
  doneToday: Readonly<Partial<Record<MuscleGroup, number>>>;
  /** Direct sets of the week so far: the ones known to be hard and the ones whose effort nobody gave. */
  week: Readonly<Partial<Record<MuscleGroup, { certain: number; uncertain: number }>>>;
  /** Direct sets one muscle may get in a day, and in the week. */
  dayMax: number;
  weekMax: (muscle: MuscleGroup) => number;
  /** The most the exercises of the session may take, in seconds; null: no limit. */
  sessionSecMax: number | null;
  /** The resistance each comparison key was last done at, and how a step up from it is judged. */
  lastResistance: ReadonlyMap<string, ResistanceSpec>;
  deload: boolean;
}

export interface AuditContext {
  mode: AuditMode;
  catalog: Readonly<Record<string, Exercise>>;
  eligibility: EligibilityContext;
  modelOf: (spec: ResistanceSpec) => ResistanceModel | null;
  /** What the day looks like; needed to audit a new plan, a start and what is left of a session. */
  day?: AuditDay;
  /** For `resume_session`: the sets already done or skipped, which are not looked at again. */
  settled?: ReadonlySet<string>;
  /** The policies the engine has, by id; the ones in `PROGRESSION_POLICIES` unless a test brings its own. */
  policies?: Readonly<Record<string, { id: string; version: string }>>;
}

const issue = (
  check: AssessmentCheck,
  scope: AuditScope,
  repairs: RepairKind[] = [],
): AuditIssue => ({ ...check, scope, repairs });

const amountOf = (s: PlannedSet): number | null =>
  s.target.kind === 'reps'
    ? s.target.target
    : s.target.kind === 'duration'
      ? s.target.targetSec
      : null;

/** The sets a muscle is credited with for this exposure: whole logical sets, a side counting half. */
function directSets(
  e: PlannedExposure,
  settled: ReadonlySet<string>,
  workingMaxRir: number,
): number {
  const counted = e.sets.filter(
    (s) =>
      !settled.has(s.id) &&
      (s.role === 'work' || s.role === 'probe' || s.role === 'backoff') &&
      (s.targetRir === null || s.targetRir.min <= workingMaxRir),
  );
  return counted.reduce((sum, s) => sum + (s.side === 'left' || s.side === 'right' ? 0.5 : 1), 0);
}

/** Findings about the whole plan and its parts that do not depend on the day. */
function structure(plan: SessionPlanV2, ctx: AuditContext): AuditIssue[] {
  const out: AuditIssue[] = [];
  const parsed = sessionPlanV2Schema.safeParse(plan);
  if (!parsed.success) {
    for (const problem of parsed.error.issues.slice(0, 10)) {
      out.push(
        issue(
          finding('PLAN_INVALID', 'fail', {
            path: problem.path.join('.'),
            message: problem.message,
          }),
          { level: 'session' },
        ),
      );
    }
    return out;
  }
  if (
    ctx.mode !== 'history_import' &&
    ctx.mode !== 'historical_display' &&
    plan.audit.planHash !== fingerprintWithout(plan, 'audit')
  ) {
    out.push(issue(finding('PLAN_INTEGRITY', 'fail'), { level: 'session' }));
  }
  return out;
}

/** Per exposure: is it a known, allowed, supported exercise, with a recipe and a trace that agree. */
function exposureFindings(e: PlannedExposure, ctx: AuditContext): AuditIssue[] {
  const out: AuditIssue[] = [];
  const scope: AuditScope = { level: 'exposure', exposureId: e.id };
  const drop: RepairKind[] = ['drop_exposure'];
  const exercise = ctx.catalog[e.exercise.id];
  if (exercise === undefined) {
    out.push(issue(finding('NOT_IN_CATALOG', 'fail', { exerciseId: e.exercise.id }), scope, drop));
  } else {
    for (const reason of ineligibility(exercise, ctx.eligibility)) {
      const code: RuleCode =
        reason === 'USER_EXCLUDED'
          ? 'USER_EXCLUDED'
          : reason === 'ARCHIVED'
            ? 'NOT_IN_CATALOG'
            : reason === 'EQUIPMENT_MISSING'
              ? 'EQUIPMENT_UNAVAILABLE'
              : 'MEDICAL_EXCLUSION';
      out.push(issue(finding(code, 'fail', { exerciseId: e.exercise.id, reason }), scope, drop));
    }
  }

  const policies = ctx.policies ?? PROGRESSION_POLICIES;
  const policy = policies[e.prescriptionPolicy.id];
  if (policy === undefined || policy.version !== e.prescriptionPolicy.version) {
    out.push(
      issue(
        finding('UNSUPPORTED_CAPABILITY', 'fail', {
          missing: 'UNKNOWN_POLICY',
          policy: `${e.prescriptionPolicy.id}@${e.prescriptionPolicy.version}`,
        }),
        scope,
        drop,
      ),
    );
  }

  if (
    e.trace.policy.id !== e.prescriptionPolicy.id ||
    e.trace.policy.version !== e.prescriptionPolicy.version ||
    !(DECISION_CODES as readonly string[]).includes(e.trace.code)
  ) {
    out.push(issue(finding('TRACE_INCONSISTENT', 'fail', { code: e.trace.code }), scope));
  }

  if (e.progressionScope === 'primary' && !e.sets.some((s) => s.requiredForProgression)) {
    out.push(issue(finding('RECIPE_INCOMPLETE', 'fail', { reason: 'no required set' }), scope));
  }
  if (e.progressionScope === 'supplemental') {
    out.push(issue(finding('SUPPLEMENTAL_ONLY', 'pass'), scope));
  }
  if (e.trace.code === 'FIRST_COMPARABLE_EXPOSURE') {
    out.push(issue(finding('CALIBRATION_FIRST', 'pass'), scope));
  }
  return out;
}

/** Per set: the equipment can do it, and the numbers are within what the data and the planner hold. */
function setFindings(
  e: PlannedExposure,
  set: PlannedSet,
  ctx: AuditContext,
  lastStep: ResistanceSpec | undefined,
  deload: boolean,
): AuditIssue[] {
  const out: AuditIssue[] = [];
  const scope: AuditScope = { level: 'set', exposureId: e.id, plannedSetId: set.id };
  const model = ctx.modelOf(set.resistance);
  if (model === null) {
    out.push(
      issue(
        finding('UNSUPPORTED_CAPABILITY', 'fail', {
          missing: 'UNKNOWN_MODEL',
          modelId: set.resistance.modelId,
        }),
        scope,
        ['drop_exposure'],
      ),
    );
  } else {
    const valid = model.validate(set.resistance.value);
    const reachable =
      valid.ok &&
      model.levels().some((l) => model.compare(l.value, set.resistance.value) === 'equal');
    if (!reachable) {
      out.push(
        issue(
          finding('RESISTANCE_UNREACHABLE', 'fail', { modelId: set.resistance.modelId }),
          scope,
          ['drop_exposure'],
        ),
      );
    } else if (lastStep !== undefined && lastStep.modelId === set.resistance.modelId) {
      // More than one step up from where the person last was (a probe is the one step that is tried).
      const one = model.nextHarder(lastStep.value);
      const jumped =
        model.compare(set.resistance.value, lastStep.value) === 'harder' &&
        (one === null || model.compare(set.resistance.value, one.value) === 'harder');
      if (jumped && set.role !== 'probe') {
        out.push(
          issue(finding('LOAD_JUMP_OVER_POLICY', 'fail', { exerciseId: e.exercise.id }), scope, [
            'drop_exposure',
          ]),
        );
      }
      if (deload && model.compare(set.resistance.value, lastStep.value) === 'harder') {
        out.push(
          issue(finding('DELOAD_WORK_OVER_POLICY', 'fail', { exerciseId: e.exercise.id }), scope, [
            'drop_exposure',
          ]),
        );
      }
    }
  }

  const amount = amountOf(set);
  const technical = set.target.kind === 'reps' ? TECHNICAL_LIMITS.reps : TECHNICAL_LIMITS.timeSec;
  const planner =
    set.target.kind === 'reps' ? PLANNER_CONFIG.limits.reps : PLANNER_CONFIG.limits.timeSec;
  const top =
    set.target.kind === 'reps'
      ? set.target.max
      : set.target.kind === 'duration'
        ? set.target.maxSec
        : null;
  if (amount !== null && top !== null) {
    if (amount < technical[0] || top > technical[1]) {
      out.push(issue(finding('TECHNICAL_LIMIT', 'fail', { what: set.target.kind, top }), scope));
    } else if (amount < planner[0] || top > planner[1]) {
      out.push(
        issue(finding('PLANNER_LIMIT', 'fail', { what: set.target.kind, top }), scope, [
          'drop_exposure',
        ]),
      );
    }
  }
  return out;
}

export function auditPlan(
  plan: SessionPlanV2,
  ctx: AuditContext,
  acknowledged: readonly string[] = [],
): AuditResult {
  const issues: AuditIssue[] = structure(plan, ctx);
  if (issues.some((i) => i.code === 'PLAN_INVALID')) {
    return { kind: 'invalid', issues, notes: [] };
  }

  // A stored plan is shown and imported as it is; only a plan that is going to be run is judged.
  const judged =
    ctx.mode === 'new_plan' || ctx.mode === 'start_session' || ctx.mode === 'resume_session';
  if (judged) {
    const settled = ctx.settled ?? new Set<string>();
    const day = ctx.day;
    const open = plan.exposures.filter(
      (e) => ctx.mode !== 'resume_session' || e.sets.some((s) => !settled.has(s.id)),
    );
    const load = new Map<MuscleGroup, number>();
    for (const e of open) {
      issues.push(...exposureFindings(e, ctx));
      const lastStep = day?.lastResistance.get(e.comparisonKey);
      for (const set of e.sets.filter((s) => !settled.has(s.id))) {
        issues.push(...setFindings(e, set, ctx, lastStep, day?.deload ?? false));
      }
      const logical = new Set(e.sets.map((s) => s.logicalSetId)).size;
      if (logical > TECHNICAL_LIMITS.sets[1]) {
        issues.push(
          issue(finding('TECHNICAL_LIMIT', 'fail', { what: 'sets', sets: logical }), {
            level: 'exposure',
            exposureId: e.id,
          }),
        );
      } else if (logical > PLANNER_CONFIG.limits.sets[1]) {
        issues.push(
          issue(
            finding('PLANNER_LIMIT', 'fail', { what: 'sets', sets: logical }),
            { level: 'exposure', exposureId: e.id },
            ['reduce_sets'],
          ),
        );
      }
      const exercise = ctx.catalog[e.exercise.id];
      if (exercise !== undefined && countsAsVolume(exercise)) {
        const sets = directSets(e, settled, TRAINING_CONFIG.workingSetMaxRir);
        for (const muscle of exercise.primaryMuscles)
          load.set(muscle, (load.get(muscle) ?? 0) + sets);
      }
    }
    if (day !== undefined) issues.push(...dayFindings(plan, open, ctx, day, load));
  }

  const failing = issues.filter((i) => i.status === 'fail');
  const blocking = failing.filter((i) => i.class === 'hard' || !acknowledged.includes(i.code));
  const notes = issues.filter((i) => !blocking.includes(i));
  if (blocking.length > 0) {
    return { kind: 'invalid', issues: sortIssues(blocking), notes: sortIssues(notes) };
  }
  return { kind: 'valid', planHash: fingerprintWithout(plan, 'audit'), notes: sortIssues(notes) };
}

/** Hard failures first, then advice, then the rest; by code, then by where, so the order does not depend on how they were found. */
function sortIssues(issues: readonly AuditIssue[]): AuditIssue[] {
  const rank = (i: AuditIssue) =>
    i.status === 'fail' && i.class === 'hard' ? 0 : i.status === 'fail' ? 1 : 2;
  const where = (i: AuditIssue) => `${i.scope.exposureId ?? ''}|${i.scope.plannedSetId ?? ''}`;
  return [...issues].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      compareCodePoints(a.code, b.code) ||
      compareCodePoints(where(a), where(b)),
  );
}

/** What depends on the day: requests, pain, recovery, the limits of volume and of time, the equipment. */
function dayFindings(
  plan: SessionPlanV2,
  open: readonly PlannedExposure[],
  ctx: AuditContext,
  day: AuditDay,
  load: ReadonlyMap<MuscleGroup, number>,
): AuditIssue[] {
  const out: AuditIssue[] = [];
  if (day.restDay && plan.source === 'engine') {
    out.push(issue(finding('REST_DAY', 'fail', { date: day.date }), { level: 'session' }));
  }
  for (const e of open) {
    const exercise = ctx.catalog[e.exercise.id];
    if (exercise === undefined) continue;
    const scope: AuditScope = { level: 'exposure', exposureId: e.id };
    const drop: RepairKind[] = ['drop_exposure'];
    if (isAvoided(exercise, day.avoided)) {
      out.push(
        issue(finding('AVOIDED_BY_REQUEST', 'fail', { exerciseId: e.exercise.id }), scope, drop),
      );
    }
    if (exercise.primaryMuscles.some((m) => day.painMuscles.has(m))) {
      out.push(issue(finding('PAIN_TODAY', 'fail', { exerciseId: e.exercise.id }), scope, drop));
    }
    if (day.isSore(exercise)) {
      out.push(issue(finding('DOMS_HIGH', 'fail', { exerciseId: e.exercise.id }), scope, drop));
    }
    if (day.isRecovering(exercise)) {
      out.push(issue(finding('RECOVERING', 'fail', { exerciseId: e.exercise.id }), scope, drop));
    }
  }

  for (const [muscle, planned] of load) {
    const done = day.doneToday[muscle] ?? 0;
    if (done + planned > day.dayMax) {
      const data: CheckData = { muscle, done, planned, after: done + planned, dayMax: day.dayMax };
      out.push(
        issue(finding('DAY_MAX_EXCEEDED', 'fail', data), { level: 'session' }, [
          'reduce_sets',
          'drop_exposure',
        ]),
      );
    }
    const week = day.week[muscle] ?? { certain: 0, uncertain: 0 };
    const upper = week.certain + week.uncertain + planned;
    if (upper > day.weekMax(muscle)) {
      const data: CheckData = {
        muscle,
        certain: week.certain,
        uncertain: week.uncertain,
        planned,
        weekMax: day.weekMax(muscle),
      };
      out.push(
        issue(finding('WEEK_MAX_EXCEEDED', 'fail', data), { level: 'session' }, [
          'reduce_sets',
          'drop_exposure',
        ]),
      );
    }
  }

  if (day.sessionSecMax !== null && plan.time.exerciseTotal > day.sessionSecMax) {
    const data: CheckData = { seconds: plan.time.exerciseTotal, max: day.sessionSecMax };
    out.push(
      issue(finding('TIME_OVER_BUDGET', 'fail', data), { level: 'session' }, [
        'drop_filler',
        'split_superset',
        'reduce_sets',
        'drop_exposure',
      ]),
    );
  }

  out.push(...resourceFindings(plan, ctx));
  return out;
}

/** An equipment set-up held for one exercise and needed in another, with no changeover planned: a second pair that is not there. */
function resourceFindings(plan: SessionPlanV2, ctx: AuditContext): AuditIssue[] {
  const sets = new Map(plan.exposures.flatMap((e) => e.sets.map((s) => [s.id, { e, s }] as const)));
  const held = new Map<string, string>();
  const begun = new Set<string>();
  const out: AuditIssue[] = [];
  let pending = new Set<string>();
  for (const step of plan.execution.steps) {
    if (step.kind === 'setup') {
      pending = new Set(step.resources.map((r) => r.resourceId));
      continue;
    }
    if (step.kind !== 'perform') continue;
    // The schema has checked that a step performs a set of the plan.
    const found = sets.get(step.plannedSetId)!;
    const first = !begun.has(found.e.id);
    begun.add(found.e.id);
    for (const claim of ctx.modelOf(found.s.resistance)?.resourceDemand(found.s.resistance.value) ??
      []) {
      const was = held.get(claim.resourceId);
      if (
        was !== undefined &&
        was !== claim.configuration &&
        !first &&
        !pending.has(claim.resourceId)
      ) {
        out.push(
          issue(
            finding('RESOURCE_CONFLICT', 'fail', {
              resource: claim.resourceId,
              held: was,
              needed: claim.configuration,
            }),
            { level: 'set', exposureId: found.e.id, plannedSetId: found.s.id },
            ['split_superset'],
          ),
        );
      }
      held.set(claim.resourceId, claim.configuration);
    }
    pending = new Set();
  }
  return out;
}
