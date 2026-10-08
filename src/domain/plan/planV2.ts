/**
 * The session plan of engine v2 (02 §2, 04 §6-§7).
 *
 * v1 stored one load and one target per exercise and left the sets to be
 * counted when the session ran. v2 stores every set of every exposure with its
 * own target, resistance, role and side, because that is what a result has to
 * be compared with: "three sets of 12" only means something once it is known
 * which sets were required, on which side, at what resistance.
 *
 * The schema checks the plan's own consistency — ids that belong together, a
 * target that has a range, a time that adds up, every set performed exactly
 * once. Whether the plan is *allowed* (equipment, limits, the person's
 * profile) is the audit's question, not the schema's.
 */

import { z } from 'zod';

import { SET_SIDES } from '../observations/types';
import { resistanceSpecSchema } from '../resistance/types';
import { parseExposureId, parsePlannedSetId } from './ids';

export const SET_ROLES = ['warmup', 'work', 'backoff', 'practice', 'mobility', 'probe'] as const;
export type SetRole = (typeof SET_ROLES)[number];

const positiveInt = z.number().int().positive();

export const quantityTargetSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('reps'),
      min: positiveInt,
      target: positiveInt,
      max: positiveInt,
      /** `per_side`: the number is for each side; `total`: for the set as a whole. */
      count: z.enum(['total', 'per_side']),
    })
    .refine((t) => t.min <= t.target && t.target <= t.max, 'min <= target <= max'),
  z
    .strictObject({
      kind: z.literal('duration'),
      minSec: positiveInt,
      targetSec: positiveInt,
      maxSec: positiveInt,
    })
    .refine((t) => t.minSec <= t.targetSec && t.targetSec <= t.maxSec, 'min <= target <= max'),
  z.strictObject({ kind: z.literal('distance'), targetMeters: z.number().positive().finite() }),
]);

export type QuantityTarget = z.infer<typeof quantityTargetSchema>;

export const plannedSetSchema = z
  .strictObject({
    id: z.string().min(1),
    logicalSetId: z.string().min(1),
    /** Sets that may be compared with each other and judged together, e.g. the working sets of one exposure. */
    comparisonGroupId: z.string().min(1),
    role: z.enum(SET_ROLES),
    side: z.enum(SET_SIDES),
    /** Position among the logical sets of the exposure, from 1. */
    ordinal: positiveInt,
    target: quantityTargetSchema,
    resistance: resistanceSpecSchema,
    targetRir: z
      .strictObject({ min: z.number().int().min(0).max(10), max: z.number().int().min(0).max(10) })
      .refine((r) => r.min <= r.max, 'min <= max')
      .nullable(),
    restAfterSec: z.number().int().nonnegative(),
    /** Whether this set has to be done, completely, for the exposure to count as evidence. */
    requiredForProgression: z.boolean(),
  })
  .superRefine((s, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    // A warm-up, a backoff, practice or a probe never stands in for a working set (T25, T26, T92).
    if (s.requiredForProgression && s.role !== 'work') issue('only a working set is required');
    const parts = parsePlannedSetId(s.id);
    if (parts === null) return issue('the id of a planned set is session/rN/exposure/ordinal[L|R]');
    if (parts.ordinal !== s.ordinal) issue('the id carries the ordinal of the set');
    if (s.logicalSetId !== (parts.side === null ? s.id : s.id.slice(0, -1))) {
      issue('the logical set is the id without its side');
    }
    const sideOfId = parts.side ?? 'neither';
    const sideOfSet = s.side === 'left' || s.side === 'right' ? s.side : 'neither';
    if (sideOfId !== sideOfSet) issue('the side in the id is the side of the set');
  });

export type PlannedSet = z.infer<typeof plannedSetSchema>;

export const decisionTraceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** What was decided: hold, advance, regress, start, ... — named by the rule registry (P3). */
  decision: z.string().min(1),
  /** A stable code; the app turns it into Polish, the AI receives it as a fact. */
  code: z.string().min(1),
  policy: z.strictObject({ id: z.string().min(1), version: z.string().min(1) }),
  /** What the decision was based on; ids and counts, never a copy of the log. */
  evidence: z.record(z.string(), z.unknown()),
  /** A prediction, when one was made, labelled as an estimate. Null when none. */
  estimate: z.record(z.string(), z.unknown()).nullable(),
});

export type DecisionTrace = z.infer<typeof decisionTraceSchema>;

export const plannedExposureSchema = z.strictObject({
  id: z.string().min(1),
  /** The slot it fills; null for a hand-made template that has no known slot. */
  slotId: z.string().min(1).nullable(),
  exercise: z.strictObject({
    id: z.string().min(1),
    /** The version of the definition the plan was made with: later edits to the catalogue do not rewrite it. */
    definitionRevision: z.string().min(1),
    displayName: z.string().min(1),
  }),
  /** What results may be compared with this one: the exercise, its technique and its resistance setup. */
  comparisonKey: z.string().min(1),
  /** Whether this exposure moves the progression on (the first of the day for its key) or only counts as work. */
  progressionScope: z.enum(['primary', 'supplemental', 'none']),
  prescriptionPolicy: z.strictObject({ id: z.string().min(1), version: z.string().min(1) }),
  sets: z.array(plannedSetSchema).min(1),
  trace: decisionTraceSchema,
});

export type PlannedExposure = z.infer<typeof plannedExposureSchema>;

/** Versions of everything that decided the plan, so it can be explained and replayed later. */
export const planVersionsSchema = z.strictObject({
  engine: z.string().min(1),
  policies: z.string().min(1),
  catalog: z.string().min(1),
  inventory: z.string().min(1),
  compiler: z.string().min(1),
  traceSchema: positiveInt,
});

export type PlanVersions = z.infer<typeof planVersionsSchema>;

export const executionStepSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('setup'),
    id: z.string().min(1),
    /** What has to be on hand and in which setup (the claims of the sets that follow). */
    resources: z.array(
      z.strictObject({
        resourceId: z.string().min(1),
        quantity: positiveInt,
        configuration: z.string(),
      }),
    ),
    estimatedSec: z.number().int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal('cue'), id: z.string().min(1), cueCode: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('perform'),
    id: z.string().min(1),
    plannedSetId: z.string().min(1),
    mode: z.enum(['reps', 'duration', 'distance']),
  }),
  z.strictObject({
    kind: z.literal('rest'),
    id: z.string().min(1),
    durationSec: z.number().int().nonnegative(),
    afterSetId: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('transition'),
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    estimatedSec: z.number().int().nonnegative(),
  }),
]);

export type ExecutionStep = z.infer<typeof executionStepSchema>;

export const executionPlanSchema = z.strictObject({
  steps: z.array(executionStepSchema),
});

const seconds = z.number().int().nonnegative();

/** Seconds, by what the time is spent on. The parts add up to `exerciseTotal`; the bike is apart (04 §7). */
export const timeBreakdownSchema = z
  .strictObject({
    hardWork: seconds,
    practice: seconds,
    mobility: seconds,
    warmup: seconds,
    rest: seconds,
    setup: seconds,
    transition: seconds,
    exerciseTotal: seconds,
    bike: seconds,
    overall: seconds,
  })
  .superRefine((t, ctx) => {
    const parts = t.hardWork + t.practice + t.mobility + t.warmup + t.rest + t.setup + t.transition;
    if (parts !== t.exerciseTotal) {
      ctx.addIssue({
        code: 'custom',
        message: 'the parts of the exercise time add up to its total',
      });
    }
    if (t.exerciseTotal + t.bike !== t.overall) {
      ctx.addIssue({ code: 'custom', message: 'overall is the exercises and the bike, each once' });
    }
  });

export type TimeBreakdown = z.infer<typeof timeBreakdownSchema>;

export const AUDIT_MODES = [
  'new_plan',
  'start_session',
  'resume_session',
  'history_import',
  'historical_display',
] as const;

/** Binds the result of an audit to the exact plan and inputs it looked at (01 §5). Not a licence to skip the next audit. */
export const auditStampSchema = z.strictObject({
  mode: z.enum(AUDIT_MODES),
  planHash: z.string().regex(/^[0-9a-f]{64}$/),
  snapshotFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  /** Advice the person chose to override, by rule code (D18, D19). Empty for a plan the engine made. */
  overrides: z.array(z.string().min(1)),
});

export type AuditStamp = z.infer<typeof auditStampSchema>;

export const sessionPlanV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    sessionId: z.string().min(1),
    planRevision: positiveInt,
    kind: z.enum(['main', 'extra', 'template']),
    source: z.enum(['engine', 'manual', 'ai_accepted', 'imported']),
    trainingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    versions: planVersionsSchema,
    inputFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    exposures: z.array(plannedExposureSchema),
    execution: executionPlanSchema,
    time: timeBreakdownSchema,
    audit: auditStampSchema,
  })
  .superRefine((plan, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const setIds = plan.exposures.flatMap((e) => e.sets.map((s) => s.id));
    if (new Set(setIds).size !== setIds.length) issue('planned set ids are unique');
    if (new Set(plan.exposures.map((e) => e.id)).size !== plan.exposures.length) {
      issue('exposure ids are unique');
    }

    for (const exposure of plan.exposures) {
      const home = parseExposureId(exposure.id);
      if (home === null) issue(`${exposure.id} is not an exposure id`);
      else if (home.sessionId !== plan.sessionId)
        issue(`${exposure.id} belongs to another session`);
      else if (home.planRevision > plan.planRevision) issue(`${exposure.id} is from the future`);
      for (const set of exposure.sets) {
        const parts = parsePlannedSetId(set.id);
        if (parts === null) continue; // the set's own check already reported it
        if (parts.sessionId !== plan.sessionId) issue(`set ${set.id} belongs to another session`);
        if (parts.planRevision > plan.planRevision) {
          issue(`set ${set.id} is from a revision that does not exist yet`);
        }
        // A later revision may add sets to an exposure, so a set can be newer than its exposure, never older.
        if (
          home !== null &&
          (parts.exposureKey !== home.exposureKey || parts.planRevision < home.planRevision)
        ) {
          issue(`set ${set.id} is not in the exposure ${exposure.id}`);
        }
      }
      // The two sides of one logical set are one set: same role, target, and resistance.
      const byLogical = new Map<string, typeof exposure.sets>();
      for (const set of exposure.sets) {
        byLogical.set(set.logicalSetId, [...(byLogical.get(set.logicalSetId) ?? []), set]);
      }
      for (const [logical, sets] of byLogical) {
        if (new Set(sets.map((s) => s.side)).size !== sets.length)
          issue(`${logical} repeats a side`);
        if (new Set(sets.map((s) => s.ordinal)).size > 1) issue(`${logical} has two ordinals`);
        if (new Set(sets.map((s) => s.role)).size > 1) issue(`${logical} mixes roles`);
      }
    }

    // Every planned set is performed exactly once, and only planned sets are (T08, T41).
    const performed = plan.execution.steps.flatMap((s) =>
      s.kind === 'perform' ? [s.plannedSetId] : [],
    );
    const known = new Set(setIds);
    for (const id of performed)
      if (!known.has(id)) issue(`a step performs ${id}, which is not planned`);
    const times = new Map<string, number>();
    for (const id of performed) times.set(id, (times.get(id) ?? 0) + 1);
    for (const id of setIds) {
      if ((times.get(id) ?? 0) !== 1)
        issue(`${id} is performed ${times.get(id) ?? 0} times, not once`);
    }
    const stepIds = plan.execution.steps.map((s) => s.id);
    if (new Set(stepIds).size !== stepIds.length) issue('step ids are unique');
  });

export type SessionPlanV2 = z.infer<typeof sessionPlanV2Schema>;
