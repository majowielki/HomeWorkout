/**
 * The second engine run day by day against a synthetic person (engine v2, 08):
 * the same idea as `simulate` of the first engine, on the second engine's parts
 * — the block with its rotation by evidence and its reactive deload, the day
 * from `planDayV2`, and the results written as the exposures the progression
 * reads. Pure. It is how the properties of the plan are tested over weeks, and
 * how the rules are compared with one another before anyone trains (P7, P8).
 */

import { fatigueSignalsV2 } from '../autoregulation/signalsV2';
import type { IsoDate } from '../observations/date';
import type { ExposureRecord } from '../observations/exposure';
import { isPerformed } from '../observations/qualify';
import type { SetObservation } from '../observations/types';
import { type TrainingPreferences, defaultPreferences } from '../preferences/preferences';
import { assess } from '../progression/assessed';
import { blockEvidence } from '../progression/stall';
import type { Ride } from '../progression/bike';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';
import { DEFAULT_MODEL_CONTEXT, type ModelContext } from '../resistance/registry';
import type { ResistanceSpec } from '../resistance/types';
import { addDays } from '../time/trainingDate';
import type { Exercise } from '../types';
import { buildHistoryIndex } from '../history';
import { fingerprint } from '../fingerprint';
import { advanceBlockV2 } from './blockV2';
import { type DayOutputV2, planDayV2 } from './dayV2';
import type { EligibilityContext } from './eligibility';
import { slotByExercise } from './eligibility';
import type { PlannedExposure, PlannedSet, SessionPlanV2 } from './planV2';
import type { BlockEvent } from './reasons';
import { modelFor, resistanceOf } from './resistanceOf';
import type { BlockState, DailyReadiness, Slot } from './types';

/** How the synthetic person performs a planned set. */
export interface AthleteV2 {
  /** Reps (or seconds) done in the set. Default: exactly the target. */
  amount(set: PlannedSet, exposure: PlannedExposure): number;
  /** Reps in reserve given for the set. Default: the lower end of the planned range. */
  rir(set: PlannedSet, exposure: PlannedExposure): number | null;
}

export const FOLLOWS_THE_PLAN_V2: AthleteV2 = {
  amount: (set) => {
    if (set.target.kind === 'distance')
      throw new Error('The v2 simulator does not support distance targets');
    return set.target.kind === 'reps' ? set.target.target : set.target.targetSec;
  },
  rir: (set) => set.targetRir?.min ?? 2,
};

export interface SimulationV2Options {
  start: IsoDate;
  days: number;
  catalog: Readonly<Record<string, Exercise>>;
  slots: readonly Slot[];
  eligibility: EligibilityContext;
  /** Dates without a session; the block still advances. */
  restDays?: ReadonlySet<string>;
  /** The morning log of a date; none by default. */
  daily?: (date: string) => DailyReadiness | null;
  athlete?: AthleteV2;
  preferences?: TrainingPreferences;
  models?: ModelContext;
  /** Dates on which the person asks for a deload. */
  deloadRequests?: ReadonlySet<string>;
}

export interface SimulatedDayV2 {
  date: IsoDate;
  block: BlockState;
  events: BlockEvent[];
  /** Null on a rest day or when there was nothing to plan. */
  plan: SessionPlanV2 | null;
  output: DayOutputV2 | null;
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
export function recordsOf(
  plan: SessionPlanV2,
  athlete: AthleteV2,
  deload = false,
): ExposureRecord[] {
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

export function simulateV2(opts: SimulationV2Options): SimulatedDayV2[] {
  const athlete = opts.athlete ?? FOLLOWS_THE_PLAN_V2;
  const preferences = opts.preferences ?? defaultPreferences();
  const models = opts.models ?? DEFAULT_MODEL_CONTEXT;
  const slotOf = slotByExercise(opts.slots);
  const modelOf = (spec: ResistanceSpec) => modelFor(spec, models);
  const records: ExposureRecord[] = [];
  const rides: Ride[] = [];
  const blocks: BlockState[] = [];
  const daily: DailyReadiness[] = [];
  const out: SimulatedDayV2[] = [];
  let block: BlockState | null = null;

  for (let i = 0; i < opts.days; i += 1) {
    const date = addDays(opts.start, i);
    const today = opts.daily?.(date) ?? null;
    if (today !== null) daily.push(today);
    const idx = buildHistoryIndex(records, opts.catalog);
    const historyOf = (slot: Slot, id: string | undefined) => {
      const exercise = id === undefined ? undefined : opts.catalog[id];
      const res = exercise === undefined ? null : resistanceOf(exercise, slot, models);
      return res === null ? null : { res, history: idx.byKey.get(res.comparisonKey) ?? [] };
    };
    const performedDates = records
      .filter((r) => r.sets.some(isPerformed))
      .map((r) => r.trainingDate);
    // The simulation appends records in training-date order.
    const lastSessionDate = performedDates.at(-1) ?? null;

    const advance = advanceBlockV2(block, {
      asOf: date,
      lastSessionDate,
      slots: opts.slots,
      catalog: opts.catalog,
      eligibility: opts.eligibility,
      preferences,
      evidence: (slot, id) => {
        const found = historyOf(slot, id);
        return found === null
          ? null
          : blockEvidence(
              assess(found.history, DEFAULT_PROGRESSION_POLICY, found.res.model),
              block!.startedOn,
              found.res.model,
              {
                introExposures: DEFAULT_PROGRESSION_POLICY.introExposures,
                window: 3,
              },
            );
      },
      recentBlocks: [...blocks].reverse().map((b) => b.selections),
      deload: {
        signals: fatigueSignalsV2({ asOf: date, records, slotOf, daily, modelOf }),
        keyExercises: opts.slots
          .filter((s) => s.kind === 'compound')
          .flatMap((s) => {
            const found = historyOf(s, block?.selections[s.id]);
            return found === null
              ? []
              : [
                  {
                    history: assess(found.history, DEFAULT_PROGRESSION_POLICY, found.res.model),
                    model: found.res.model,
                  },
                ];
          }),
        daily,
        requested: opts.deloadRequests?.has(date) ?? false,
      },
    });
    if (advance.closed !== null) blocks.push(advance.closed);
    block = advance.block;

    if (opts.restDays?.has(date)) {
      out.push({ date, block, events: advance.events, plan: null, output: null, records: [] });
      continue;
    }
    const fingerprintOf = fingerprint({ date, records: records.length, block: block.index });
    const output = planDayV2({
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
        versions: {
          engine: '2.0.0',
          policies: 'policy-2.0',
          catalog: 'catalog-1',
          inventory: 'inventory-1',
          compiler: 'compiler-1',
          traceSchema: 1,
        },
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
