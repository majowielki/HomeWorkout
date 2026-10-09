/**
 * One compiler from recipes to a session plan (engine v2, 04 §6-§7, 01 §3).
 *
 * It takes the recipe of every exposure — each set with its role, resistance,
 * target and rest — and produces the plan the person will run: planned sets
 * with stable ids, the steps in the order they are done, and the time they take.
 * It decides nothing about the training. It never changes a resistance or the
 * number of sets; it only puts them in order, and says what has to be done in
 * between (a changeover, a change of set-up of the equipment).
 *
 * Every planned set is performed exactly once; a set done on two sides is two
 * planned sets, one per side. The time is the sum of what the steps cost, and
 * each second is in one category only (04 §7).
 */

import { EXECUTION_CONFIG, PLANNER_CONFIG } from '../config/training';
import { exposureId as exposureIdOf, logicalSetId, plannedSetId } from './ids';
import { fingerprint } from '../fingerprint';
import type { ResistanceModel, ResistanceSpec } from '../resistance/types';
import {
  type DecisionTrace,
  type ExecutionStep,
  type PlanVersions,
  type PlannedExposure,
  type PlannedSet,
  type SessionPlanV2,
  type SetRole,
  type TimeBreakdown,
} from './planV2';

/** How a set that has two sides is done. */
export type SideMode =
  /** Two-sided work: one set, no sides. */
  | 'bilateral'
  /** One side per set: a logical set is two planned sets, one for each side. */
  | 'per_set'
  /** The sides alternate inside the set; the count is for the set. */
  | 'alternating'
  /** Both sides in the one set, the same count on each. */
  | 'both';

export interface SetSpec {
  role: SetRole;
  resistance: ResistanceSpec;
  /** The bottom, the aim and the top of the target, in reps or seconds. */
  lo: number;
  target: number;
  hi: number;
  targetRir: { min: number; max: number } | null;
  restAfterSec: number;
  /** The set has to be done, completely, for the exposure to count as evidence. Only a working set can be. */
  required: boolean;
}

export interface ExposureSpec {
  /** Local to the session and safe in an id: `e1`. */
  key: string;
  slotId: string | null;
  exercise: PlannedExposure['exercise'];
  comparisonKey: string;
  scope: PlannedExposure['progressionScope'];
  policy: PlannedExposure['prescriptionPolicy'];
  unit: 'reps' | 'duration';
  sideMode: SideMode;
  /** For `per_set`: which side is done first. */
  firstSide?: 'left' | 'right';
  /** The logical sets in the order of the exposure; a probe set comes first. */
  sets: readonly SetSpec[];
  /** Exposures with the same group are a superset and are done round by round. */
  group: string | null;
  /** Light work that only fills a short day: the first thing to go when the time is over. */
  filler?: boolean;
  /** The band is stretched a few times first (a cue, not a set). */
  bandWarmup: boolean;
  trace: DecisionTrace;
}

export interface Timing {
  secondsPerRep: number;
  changeoverSec: number;
  bandWarmupSec: number;
  setupSec: number;
}

export const DEFAULT_TIMING: Timing = {
  secondsPerRep: PLANNER_CONFIG.secondsPerRep,
  changeoverSec: PLANNER_CONFIG.exerciseChangeoverSec,
  bandWarmupSec: PLANNER_CONFIG.bandWarmupSec,
  setupSec: EXECUTION_CONFIG.setupSec,
};

export interface CompileInput {
  sessionId: string;
  planRevision: number;
  kind: SessionPlanV2['kind'];
  source: SessionPlanV2['source'];
  trainingDate: string;
  versions: PlanVersions;
  inputFingerprint: string;
  exposures: readonly ExposureSpec[];
  /** Seconds of the ride that comes on top of the exercises. */
  bikeSec: number;
  /** The model of a resistance, for the equipment each set needs; null if it is not known. */
  modelOf: (spec: ResistanceSpec) => ResistanceModel | null;
  timing?: Timing;
}

/** A plan before it has been audited: everything but the stamp that says it was. */
export type PlanDraftV2 = Omit<SessionPlanV2, 'audit'>;

/** One unit of the order: a planned set with where it belongs. */
interface Unit {
  exposure: ExposureSpec;
  set: PlannedSet;
  spec: SetSpec;
  /** The exposure’s own position in the plan, to keep the order stable. */
  exposureIndex: number;
}

const sidesOf = (e: ExposureSpec): ('left' | 'right' | null)[] =>
  e.sideMode === 'per_set'
    ? e.firstSide === 'right'
      ? ['right', 'left']
      : ['left', 'right']
    : [null];

function plannedSetsOf(
  e: ExposureSpec,
  sessionId: string,
  planRevision: number,
): { set: PlannedSet; spec: SetSpec }[] {
  const id = exposureIdOf(sessionId, planRevision, e.key);
  const out: { set: PlannedSet; spec: SetSpec }[] = [];
  e.sets.forEach((spec, index) => {
    const ordinal = index + 1;
    for (const side of sidesOf(e)) {
      const parts = { sessionId, planRevision, exposureKey: e.key, ordinal };
      const lo = Math.min(spec.lo, spec.target);
      const target = Math.max(lo, Math.min(spec.target, spec.hi));
      const hi = spec.hi;
      out.push({
        spec,
        set: {
          id: plannedSetId({ ...parts, side }),
          logicalSetId: logicalSetId(parts),
          comparisonGroupId: `${id}/${spec.role}`,
          role: spec.role,
          side: side ?? (e.sideMode === 'alternating' ? 'alternating' : 'bilateral'),
          ordinal,
          target:
            e.unit === 'reps'
              ? {
                  kind: 'reps',
                  min: lo,
                  target,
                  max: hi,
                  count: e.sideMode === 'both' ? 'per_side' : 'total',
                }
              : { kind: 'duration', minSec: lo, targetSec: target, maxSec: hi },
          resistance: spec.resistance,
          targetRir: spec.targetRir,
          restAfterSec: spec.restAfterSec,
          requiredForProgression: spec.required && spec.role === 'work',
        },
      });
    }
  });
  return out;
}

/**
 * The order of the sets: group by group, round by round, and inside a round the members of the
 * superset in the order of the plan. The same exercise twice in a row is avoided inside a group where
 * another member still has a set to do; a group of one runs its sets in order (04 §6).
 */
function ordered(units: readonly Unit[]): Unit[] {
  const groups = new Map<string, Unit[]>();
  for (const unit of units) {
    const key = unit.exposure.group ?? `solo:${unit.exposure.key}`;
    groups.set(key, [...(groups.get(key) ?? []), unit]);
  }
  const out: Unit[] = [];
  for (const members of groups.values()) {
    const rounds = Math.max(...members.map((u) => u.set.ordinal));
    const raw: Unit[] = [];
    for (let round = 1; round <= rounds; round += 1) {
      for (const exposureIndex of [...new Set(members.map((u) => u.exposureIndex))]) {
        raw.push(
          ...members.filter((u) => u.exposureIndex === exposureIndex && u.set.ordinal === round),
        );
      }
    }
    // The tail of a superset whose members have different numbers of sets: do not repeat an exercise
    // while another one still has something to do.
    const rest = [...raw];
    const done: Unit[] = [];
    while (rest.length > 0) {
      const previous = done[done.length - 1];
      const other =
        previous === undefined
          ? 0
          : rest.findIndex((u) => u.exposureIndex !== previous.exposureIndex);
      done.push(rest.splice(Math.max(0, other), 1)[0]!);
    }
    out.push(...done);
  }
  return out;
}

const workSeconds = (u: Unit, t: Timing): number => {
  const base = u.exposure.unit === 'duration' ? u.spec.target : u.spec.target * t.secondsPerRep;
  return Math.round(base * (u.exposure.sideMode === 'both' ? 2 : 1));
};

export function compileSession(input: CompileInput): PlanDraftV2 {
  const timing = input.timing ?? DEFAULT_TIMING;
  const exposures: PlannedExposure[] = [];
  const units: Unit[] = [];

  input.exposures.forEach((e, exposureIndex) => {
    const sets = plannedSetsOf(e, input.sessionId, input.planRevision);
    exposures.push({
      id: exposureIdOf(input.sessionId, input.planRevision, e.key),
      slotId: e.slotId,
      exercise: e.exercise,
      comparisonKey: e.comparisonKey,
      progressionScope: e.scope,
      prescriptionPolicy: e.policy,
      sets: sets.map((s) => s.set),
      trace: e.trace,
    });
    for (const { set, spec } of sets) units.push({ exposure: e, set, spec, exposureIndex });
  });

  const sequence = ordered(units);
  const steps: ExecutionStep[] = [];
  const time = {
    hardWork: 0,
    practice: 0,
    mobility: 0,
    warmup: 0,
    rest: 0,
    setup: 0,
    transition: 0,
  };
  const configured = new Map<string, string>();
  const begun = new Set<string>();
  let previousExposure: string | null = null;
  let n = 0;
  const next = (prefix: string) => `${prefix}${(n += 1)}`;

  sequence.forEach((u, position) => {
    const exposureId = exposures[u.exposureIndex]!.id;
    const first = !begun.has(u.exposure.key);
    begun.add(u.exposure.key);
    if (first) {
      steps.push({
        kind: 'transition',
        id: next('t'),
        from: previousExposure ?? 'start',
        to: exposureId,
        estimatedSec: timing.changeoverSec,
      });
      time.transition += timing.changeoverSec;
    }
    previousExposure = exposureId;
    if (first && u.exposure.bandWarmup) {
      steps.push({ kind: 'cue', id: next('c'), cueCode: 'BAND_WARMUP' });
      time.warmup += timing.bandWarmupSec;
    }

    // Equipment: a piece set up for one exercise and needed in another set-up costs a changeover, unless
    // this is the first time the exercise is started (the changeover into it covers that).
    const model = input.modelOf(u.spec.resistance);
    const changed: { resourceId: string; quantity: number; configuration: string }[] = [];
    for (const claim of model?.resourceDemand(u.spec.resistance.value) ?? []) {
      const held = configured.get(claim.resourceId);
      if (held !== undefined && held !== claim.configuration && !first) {
        changed.push({
          resourceId: claim.resourceId,
          quantity: claim.quantity,
          configuration: claim.configuration,
        });
      }
      configured.set(claim.resourceId, claim.configuration);
    }
    if (changed.length > 0) {
      steps.push({
        kind: 'setup',
        id: next('s'),
        resources: changed,
        estimatedSec: timing.setupSec,
      });
      time.setup += timing.setupSec;
    }

    steps.push({
      kind: 'perform',
      id: next('p'),
      plannedSetId: u.set.id,
      mode: u.exposure.unit === 'reps' ? 'reps' : 'duration',
    });
    const seconds = workSeconds(u, timing);
    if (u.spec.role === 'warmup') time.warmup += seconds;
    else if (u.spec.role === 'practice') time.practice += seconds;
    else if (u.spec.role === 'mobility') time.mobility += seconds;
    else time.hardWork += seconds;

    if (position < sequence.length - 1) {
      steps.push({
        kind: 'rest',
        id: next('r'),
        durationSec: u.spec.restAfterSec,
        afterSetId: u.set.id,
      });
      time.rest += u.spec.restAfterSec;
    }
  });

  const exerciseTotal =
    time.hardWork +
    time.practice +
    time.mobility +
    time.warmup +
    time.rest +
    time.setup +
    time.transition;
  const breakdown: TimeBreakdown = {
    ...time,
    exerciseTotal,
    bike: input.bikeSec,
    overall: exerciseTotal + input.bikeSec,
  };

  return {
    schemaVersion: 2,
    sessionId: input.sessionId,
    planRevision: input.planRevision,
    kind: input.kind,
    source: input.source,
    trainingDate: input.trainingDate,
    versions: input.versions,
    inputFingerprint: input.inputFingerprint,
    exposures,
    execution: { steps },
    time: breakdown,
  };
}

/**
 * The plan with the stamp of the audit that passed it: the mode, the inputs, the advice the person
 * confirmed, and the hash of the plan as audited. The hash is of everything but the stamp (01 §4).
 */
export function stampPlan(
  draft: PlanDraftV2,
  stamp: { mode: SessionPlanV2['audit']['mode']; snapshotFingerprint: string; overrides: string[] },
): SessionPlanV2 {
  return { ...draft, audit: { ...stamp, planHash: fingerprint(draft) } };
}
