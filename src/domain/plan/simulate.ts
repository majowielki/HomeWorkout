/**
 * The engine run day by day against a synthetic person (engine, 08):
 * the same idea as `simulate` of historical sessions, on the engine's parts
 * — the block with its rotation by evidence and its reactive deload, the day
 * from `planDay`, and the results written as the exposures the progression
 * reads. Pure. It is how the properties of the plan are tested over weeks, and
 * how the rules are compared with one another before anyone trains (P7, P8).
 */

import type { IsoDate } from '../observations/date';
import type { ExposureRecord } from '../observations/exposure';
import type { SetObservation } from '../observations/types';
import { type TrainingPreferences, defaultPreferences } from '../preferences/preferences';
import type { Ride } from '../progression/bike';
import { DEFAULT_MODEL_CONTEXT, type ModelContext } from '../resistance/registry';
import { addDays } from '../time/trainingDate';
import type { Exercise } from '../types';
import { fingerprint } from '../fingerprint';
import { blockContext } from './blockContext';
import { advanceBlock } from './block';
import { type DayOutput, planDay } from './day';
import type { EligibilityContext } from './eligibility';
import type { PlannedExposure, PlannedSet, SessionPlan } from './plan';
import type { BlockEvent } from './reasons';
import type { BlockState, DailyReadiness, Slot } from './types';
import { planVersions } from './versions';

/** How the synthetic person performs a planned set. */
export interface Athlete {
  /** Reps (or seconds) done in the set. Default: exactly the target. */
  amount(set: PlannedSet, exposure: PlannedExposure): number;
  /** Reps in reserve given for the set. Default: the lower end of the planned range. */
  rir(set: PlannedSet, exposure: PlannedExposure): number | null;
}

export const FOLLOWS_THE_PLAN: Athlete = {
  amount: (set) => {
    if (set.target.kind === 'distance')
      throw new Error('The v2 simulator does not support distance targets');
    return set.target.kind === 'reps' ? set.target.target : set.target.targetSec;
  },
  rir: (set) => set.targetRir?.min ?? 2,
};

export interface SimulationOptions {
  start: IsoDate;
  days: number;
  catalog: Readonly<Record<string, Exercise>>;
  slots: readonly Slot[];
  eligibility: EligibilityContext;
  /** Dates without a session; the block still advances. */
  restDays?: ReadonlySet<string>;
  /** The morning log of a date; none by default. */
  daily?: (date: string) => DailyReadiness | null;
  athlete?: Athlete;
  preferences?: TrainingPreferences;
  models?: ModelContext;
  /** Dates on which the person asks for a deload. */
  deloadRequests?: ReadonlySet<string>;
}

export interface SimulatedDay {
  date: IsoDate;
  block: BlockState;
  events: BlockEvent[];
  /** Null on a rest day or when there was nothing to plan. */
  plan: SessionPlan | null;
  output: DayOutput | null;
  /** What the person did that day, as the progression reads it. */
  records: ExposureRecord[];
}

const shown = {
  confirmedAt: null,
  channel: 'touch' as const,
};

/** The result of a set as the logger would store it: the person entered the amount and the effort. */
export function observationOf(
  set: PlannedSet,
  exposure: PlannedExposure,
  sessionId: string,
  date: IsoDate,
  amount: number,
  rir: number | null,
): SetObservation {
  if (set.target.kind === 'distance')
    throw new Error('The v2 simulator does not support distance targets');
  const edited = {
    ...shown,
    origin: 'user_reported' as const,
    presentedDefault: false,
    confirmation: 'edited' as const,
  };
  const suggestion = {
    ...shown,
    origin: 'user_confirmed' as const,
    presentedDefault: true,
    confirmation: 'visible' as const,
  };
  const at = `${date}T08:00:00.000Z`;
  return {
    id: `obs-${set.id}`,
    commandId: `cmd-${set.id}`,
    revision: 1,
    sessionId,
    exposureId: exposure.id,
    plannedSetId: set.id,
    logicalSetId: set.logicalSetId,
    side: set.side,
    status: 'performed',
    amount: {
      ...edited,
      value:
        set.target.kind === 'duration'
          ? { kind: 'duration', seconds: amount }
          : { kind: 'reps', reps: amount },
    },
    resistance: { ...suggestion, value: set.resistance },
    rir: { ...edited, value: rir },
    shortfall: null,
    performedAt: at,
    recordedAt: at,
  };
}

/** The exposures a plan makes once it has been done: every set performed as the athlete does it. */
export function recordsOf(plan: SessionPlan, athlete: Athlete, deload = false): ExposureRecord[] {
  return plan.exposures.map((exposure) => ({
    exposureId: exposure.id,
    sessionId: plan.sessionId,
    trainingDate: plan.trainingDate,
    exerciseId: exposure.exercise.id,
    slotId: exposure.slotId,
    comparisonKey: exposure.comparisonKey,
    progressionScope: exposure.progressionScope,
    sets: exposure.sets.map((planned) => ({
      planned,
      disposition: 'performed' as const,
      observation: observationOf(
        planned,
        exposure,
        plan.sessionId,
        plan.trainingDate,
        athlete.amount(planned, exposure),
        athlete.rir(planned, exposure),
      ),
    })),
    extra: [],
    context: { abandoned: false, userReduced: false, feel: null, deload },
  }));
}

export function simulate(opts: SimulationOptions): SimulatedDay[] {
  const athlete = opts.athlete ?? FOLLOWS_THE_PLAN;
  const preferences = opts.preferences ?? defaultPreferences();
  const models = opts.models ?? DEFAULT_MODEL_CONTEXT;
  const records: ExposureRecord[] = [];
  const rides: Ride[] = [];
  const blocks: BlockState[] = [];
  const daily: DailyReadiness[] = [];
  const out: SimulatedDay[] = [];
  let block: BlockState | null = null;

  for (let i = 0; i < opts.days; i += 1) {
    const date = addDays(opts.start, i);
    const today = opts.daily?.(date) ?? null;
    if (today !== null) daily.push(today);
    const advance = advanceBlock(
      block,
      blockContext({
        asOf: date,
        block,
        records,
        daily,
        slots: opts.slots,
        catalog: opts.catalog,
        eligibility: opts.eligibility,
        preferences,
        models,
        recentBlocks: [...blocks].reverse().map((b) => b.selections),
        deloadRequested: opts.deloadRequests?.has(date) ?? false,
      }),
    );
    if (advance.closed !== null) blocks.push(advance.closed);
    block = advance.block;

    if (opts.restDays?.has(date)) {
      out.push({ date, block, events: advance.events, plan: null, output: null, records: [] });
      continue;
    }
    const fingerprintOf = fingerprint({ date, records: records.length, block: block.index });
    const output = planDay({
      asOf: date,
      catalog: opts.catalog,
      slots: opts.slots,
      eligibility: opts.eligibility,
      block,
      records,
      rides,
      daily,
      preferences,
      models,
      session: {
        sessionId: `s${date.replaceAll('-', '')}`,
        planRevision: 1,
        kind: 'main',
        versions: planVersions('catalog-1'),
        snapshotFingerprint: fingerprintOf,
        inputFingerprint: fingerprintOf,
      },
    });
    const plan =
      output.result.kind === 'ready' || output.result.kind === 'adjusted'
        ? output.result.plan
        : null;
    const made = plan === null ? [] : recordsOf(plan, athlete, output.phase === 'deload');
    if (plan !== null) {
      records.push(...made);
      rides.push({
        date,
        minutes: output.bike.minutes,
        resistance: output.bike.resistance,
        rpe: null,
      });
    }
    out.push({ date, block, events: advance.events, plan, output, records: made });
  }
  return out;
}
