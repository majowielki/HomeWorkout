/**
 * The week ahead on the engine (engine, 04 §5, 06 §7, P5.1).
 *
 * Day by day, like the simulation: each day is chosen from the history plus the
 * days before it done as planned, so Thursday already counts Tuesday's sets.
 * What is kept is the *choice* of a day — slot, exercise, sets — never a load:
 * the load is worked out from the history as it is when the day is built.
 * A day chosen earlier stays while it still passes the planner's rules; the
 * week is firm and changes only where it has to.
 *
 * The forecast is a forecast. The sets a later day is planned after are made
 * up from the plan of the day before and live only inside this function: they
 * are not part of the result, are never written, and nothing here reads a
 * result back as if it had been done. The history that comes in is not touched.
 */

import { WEEK_CONFIG } from '../config/training';
import { buildHistoryIndex } from '../history';
import { fingerprint } from '../fingerprint';
import type { IsoDate } from '../observations/date';
import type { ExposureRecord } from '../observations/exposure';
import type { TrainingPreferences } from '../preferences/preferences';
import type { Ride } from '../progression/bike';
import { DEFAULT_MODEL_CONTEXT, type ModelContext } from '../resistance/registry';
import { addDays, daysBetween } from '../time/trainingDate';
import type { Exercise, MuscleGroup } from '../types';
import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { blockContext } from './blockContext';
import { advanceBlock } from './block';
import {
  composedRequest,
  dateRange,
  isTrainingDay,
  type PlanConstraint,
  TRAIN_DAILY,
  type TrainingWeek,
} from './constraints';
import { type DayInput, type DayOutput, type KeptItem, planDay, regionsOf, weekWork } from './day';
import type { EligibilityContext } from './eligibility';
import type { PlanVersions, SessionPlan } from './plan';
import type { BlockEvent } from './reasons';
import { type Athlete, FOLLOWS_THE_PLAN, observationOf, recordsOf } from './simulate';
import type { BlockAdvance } from './blockSelection';
import type { BlockState, DailyReadiness, Slot, SlotRegion } from './types';

export interface WeekInput {
  /** The first day to plan. */
  from: IsoDate;
  days: number;
  catalog: Readonly<Record<string, Exercise>>;
  slots: readonly Slot[];
  eligibility: EligibilityContext;
  /** The stored block as last advanced (on or before `from`); null before the first one. */
  block: BlockState | null;
  /** The blocks that have ended, newest first. */
  endedBlocks: readonly BlockState[];
  /** What was done, as the engine reads it: real results only. */
  records: readonly ExposureRecord[];
  rides: readonly Ride[];
  daily: readonly DailyReadiness[];
  preferences: TrainingPreferences;
  models?: ModelContext;
  /** What the person answered to the questions of the prescriptions, by comparison key. */
  answers?: DayInput['answers'];
  constraints?: readonly PlanConstraint[];
  week?: TrainingWeek;
  /** Days chosen earlier, by date; each stays while it still passes the planner's rules. */
  kept?: Readonly<Record<string, readonly KeptItem[]>>;
  /** A session of today that is under way: what is left of it counts as done in the forecasts after it. */
  running?: SessionPlan | null;
  versions: PlanVersions;
  /** The fingerprint of what the week is planned from; each forecast day derives its own. */
  snapshotFingerprint: string;
  /** Dates on which the person asked for a deload. */
  deloadRequests?: ReadonlySet<string>;
  /** How the forecast assumes the person performs: exactly as planned, unless a test says otherwise. */
  athlete?: Athlete;
}

/**
 * What a day was planned for, beside its choice of exercises: what the explanation of the day and the
 * week the chat reads are made of. Stored with the day, because a forecast plan does not carry it.
 */
export interface DaySummary {
  phase: 'work' | 'deload';
  dayReasons: string[];
  regions: SlotRegion[];
  skipped: { slotId: string; exerciseId: string | null; reason: string }[];
  composed: boolean;
  estimatedMinutes: number;
  /** The block the day belonged to, the signals of overload and the ride of the day. */
  blockIndex?: number;
  signals?: string[];
  bike?: { minutes: number; reasons: string[] };
}

export function summaryOf(
  output: DayOutput,
  forecast: SessionPlan | null,
  composed: boolean,
  blockIndex?: number,
): DaySummary {
  return {
    phase: output.phase,
    dayReasons: [...output.dayReasons],
    regions: [...output.regions],
    skipped: output.skipped.map((x) => ({
      slotId: x.slotId,
      exerciseId: x.exerciseId,
      reason: x.reason,
    })),
    composed,
    estimatedMinutes: forecast === null ? 0 : Math.round(forecast.time.exerciseTotal / 60),
    ...(blockIndex === undefined ? {} : { blockIndex }),
    signals: [...output.signals],
    bike: { minutes: output.bike.minutes, reasons: [...output.bike.reasons] },
  };
}

export interface WeekDay {
  date: IsoDate;
  /** A rest day: from the weekly pattern or asked for. */
  rest: boolean;
  /** What to train; null on a rest day. Empty when no plan could be made. */
  selection: KeptItem[] | null;
  /** The day as it would be built if everything before it goes as planned — a forecast, not a result. */
  forecast: SessionPlan | null;
  output: DayOutput | null;
  summary: DaySummary | null;
  /** kept: as chosen earlier; changed: chosen earlier but no longer holds; new: not chosen before. */
  status: 'kept' | 'changed' | 'new';
  /** Why a day chosen earlier was chosen again. */
  violations: { slotId: string; reason: string }[];
  /** What happens to the block that day (rotation, deload). */
  events: BlockEvent[];
  /** The day's movements were composed with the coach (a `compose_day` request). */
  composed: boolean;
  /** The block as it is that day. */
  block: BlockState;
}

export interface WeekPlan {
  from: IsoDate;
  days: WeekDay[];
  /** What the block did on each day, in the order of `days`: the first is what to store. */
  advances: BlockAdvance[];
  /** Direct working sets per muscle over the 7 days ending on the last day, the plan done. */
  volume: Record<MuscleGroup, number>;
}

/** The sets of a running session still to do, counted as done as planned. */
export function completedAsPlanned(
  records: readonly ExposureRecord[],
  plan: SessionPlan,
  athlete: Athlete = FOLLOWS_THE_PLAN,
): ExposureRecord[] {
  const exposures = new Map(plan.exposures.map((e) => [e.id, e]));
  return records.map((r) => {
    const exposure = exposures.get(r.exposureId);
    if (r.sessionId !== plan.sessionId || exposure === undefined) return r;
    return {
      ...r,
      sets: r.sets.map((s) =>
        s.disposition !== 'pending'
          ? s
          : {
              ...s,
              disposition: 'performed' as const,
              observation: observationOf(
                s.planned,
                exposure,
                plan.sessionId,
                r.trainingDate,
                athlete.amount(s.planned, exposure),
                athlete.rir(s.planned, exposure),
              ),
            },
      ),
    };
  });
}

export function planWeek(input: WeekInput): WeekPlan {
  const { catalog, slots, eligibility } = input;
  const constraints = input.constraints ?? [];
  const week = input.week ?? TRAIN_DAILY;
  const models = input.models ?? DEFAULT_MODEL_CONTEXT;
  const athlete = input.athlete ?? FOLLOWS_THE_PLAN;
  const records: ExposureRecord[] =
    input.running == null
      ? [...input.records]
      : completedAsPlanned(input.records, input.running, athlete);
  const rides = [...input.rides];
  const ended = [...input.endedBlocks];
  let block = input.block;
  const days: WeekDay[] = [];
  const advances: BlockAdvance[] = [];

  for (const date of dateRange(input.from, input.days)) {
    const advance = advanceBlock(
      block,
      blockContext({
        asOf: date,
        block,
        records,
        daily: input.daily,
        slots,
        catalog,
        eligibility,
        preferences: input.preferences,
        models,
        recentBlocks: ended.map((b) => b.selections),
        deloadRequested: input.deloadRequests?.has(date) ?? false,
      }),
    );
    if (advance.closed !== null) ended.unshift(advance.closed);
    block = advance.block;
    advances.push(advance);
    const stored = input.kept?.[date];

    if (!isTrainingDay(date, week, constraints)) {
      days.push({
        date,
        rest: true,
        selection: null,
        forecast: null,
        output: null,
        summary: null,
        status: stored ? 'changed' : 'new',
        violations: stored ? [{ slotId: '', reason: 'REST_DAY' }] : [],
        events: advance.events,
        composed: false,
        block,
      });
      continue;
    }

    const composed = composedRequest(constraints, date);
    const print = fingerprint({
      week: input.snapshotFingerprint,
      date,
      projected: records.length,
      block: block.index,
    });
    const output = planDay({
      asOf: date,
      intent: composed === null ? 'auto_day' : 'compose',
      catalog,
      slots,
      eligibility,
      block,
      records,
      rides,
      daily: input.daily,
      constraints,
      week,
      preferences: input.preferences,
      models,
      answers: input.answers,
      ...(composed === null
        ? stored === undefined
          ? {}
          : { kept: stored }
        : { only: composed.only, acknowledged: composed.acknowledged }),
      session: {
        sessionId: `forecast-${date}`,
        planRevision: 1,
        kind: 'main',
        versions: input.versions,
        snapshotFingerprint: print,
        inputFingerprint: print,
      },
    });
    const forecast =
      output.result.kind === 'ready' || output.result.kind === 'adjusted'
        ? output.result.plan
        : null;
    const missing =
      composed === null
        ? output.keptViolations.map((v) => ({ slotId: v.slotId, reason: v.reason }))
        : composed.only
            .filter((i) => !output.selection.some((s) => s.slotId === i.slotId))
            .map((i) => ({
              slotId: i.slotId,
              reason: output.skipped.find((s) => s.slotId === i.slotId)?.reason ?? 'NOT_PICKED',
            }));
    days.push({
      date,
      rest: false,
      selection: output.selection,
      forecast,
      output,
      summary: summaryOf(output, forecast, composed !== null, block.index),
      status:
        stored === undefined
          ? 'new'
          : composed === null
            ? output.kept === 'held'
              ? 'kept'
              : 'changed'
            : sameSelection(stored, output.selection)
              ? 'kept'
              : 'changed',
      violations: missing,
      events: advance.events,
      composed: composed !== null,
      block,
    });
    if (forecast !== null) {
      records.push(...recordsOf(forecast, athlete, output.phase === 'deload'));
      rides.push({
        date,
        minutes: output.bike.minutes,
        resistance: output.bike.resistance,
        rpe: null,
      });
    }
  }

  const lastDay = days[days.length - 1]?.date ?? input.from;
  const work = weekWork(buildHistoryIndex(records, catalog), lastDay);
  return {
    from: input.from,
    days,
    advances,
    volume: Object.fromEntries(
      MUSCLE_GROUPS.map((m) => [m, work[m].certain + work[m].uncertain]),
    ) as Record<MuscleGroup, number>,
  };
}

/** The same training: items equal in slot, exercise and sets. */
export function sameSelection(
  a: readonly KeptItem[] | null,
  b: readonly KeptItem[] | null,
): boolean {
  if (a === null || b === null) return a === b;
  const key = (s: readonly KeptItem[]) =>
    JSON.stringify(s.map((i) => [i.slotId, i.exerciseId, i.sets]));
  return key(a) === key(b);
}

// ---------------------------------------------------------------------------- stored week

export interface StoredDay {
  date: IsoDate;
  /** Null on a rest day. */
  selection: KeptItem[] | null;
  forecast: SessionPlan | null;
  /** What the day was planned for; absent on a day stored before it was kept. */
  summary?: DaySummary | null;
  status: 'planned' | 'done' | 'missed';
}

/** One day of the week that is not what it was — for the banner and the calendar. */
export interface StoredDayChange {
  date: IsoDate;
  /** The day's regions before and after; null for a rest day. */
  before: SlotRegion[] | null;
  after: SlotRegion[] | null;
  /** The rules the stored day broke; empty when the week was planned from scratch. */
  reasons: string[];
}

export interface SyncInput extends Omit<WeekInput, 'from' | 'days' | 'kept'> {
  asOf: IsoDate;
  stored: readonly StoredDay[];
  /** Training dates with a completed session. */
  trainedDates: ReadonlySet<string>;
  /** An explicit request: plan from scratch from `from` (today or later). */
  request?: { trigger: 'manual' | 'constraint' | 'coach'; from?: IsoDate };
  /** How many days from today the plan reaches, today included. */
  horizonDays?: number;
}

export interface SyncResult {
  /** The first day planned: today, or tomorrow once today has a session. */
  from: IsoDate;
  week: WeekPlan;
  /** Past days to mark. */
  statusUpdates: { date: IsoDate; status: 'done' | 'missed' }[];
  /** What to store from `from` on. */
  rows: StoredDay[];
  changes: StoredDayChange[];
  /** Why it was planned again; null when nothing but the forecast changed. */
  trigger: SyncTrigger | null;
}

/**
 * Brings the stored week up to date: past days are marked done or missed, the
 * horizon is kept at seven days from today, and the week is planned with every
 * stored day kept while it still holds. A missed day, or an explicit request,
 * plans from scratch.
 */
export function syncWeek(input: SyncInput): SyncResult {
  const { asOf, stored, trainedDates } = input;
  const horizon = input.horizonDays ?? WEEK_CONFIG.horizonDays;
  const byDate = new Map(stored.map((d) => [d.date, d]));

  const statusUpdates: SyncResult['statusUpdates'] = [];
  const missed: string[] = [];
  // A session begun on an earlier day and still under way (the day turned over while it ran) is not a miss.
  const underWay = input.running?.trainingDate;
  for (const day of stored) {
    if (day.status !== 'planned') continue;
    if (day.date === underWay && day.date < asOf) continue;
    const trained = trainedDates.has(day.date);
    if (day.date < asOf) {
      const status = trained || day.selection === null ? 'done' : 'missed';
      statusUpdates.push({ date: day.date, status });
      if (status === 'missed') missed.push(day.date);
    } else if (day.date === asOf && trained) {
      statusUpdates.push({ date: day.date, status: 'done' });
    }
  }

  // Today is taken once it has a session, finished or under way.
  const from = trainedDates.has(asOf) || input.running != null ? addDays(asOf, 1) : asOf;
  const requested = input.request ? [input.request.from ?? from, from].sort()[1]! : null;
  const freshFrom = requested ?? (missed.length > 0 ? from : null);
  const kept = Object.fromEntries(
    stored.flatMap((d) =>
      d.selection !== null && d.date >= from && (freshFrom === null || d.date < freshFrom)
        ? [[d.date, d.selection]]
        : [],
    ),
  );

  const last = addDays(asOf, horizon - 1);
  const week = planWeek({
    ...input,
    from,
    days: Math.max(0, daysBetween(from, last) + 1),
    kept,
  });

  const slotById = new Map(input.slots.map((s) => [s.id, s]));
  const changes: StoredDayChange[] = [];
  let added = false;
  for (const day of week.days) {
    const before = byDate.get(day.date);
    if (!before) {
      added = true;
      continue;
    }
    if (sameSelection(before.selection, day.selection)) continue;
    changes.push({
      date: day.date,
      before: before.forecast === null ? null : regionsOf(before.forecast.exposures, slotById),
      after: day.output === null ? null : day.output.regions,
      reasons: [...new Set(day.violations.map((v) => v.reason))],
    });
  }

  const blockMoved = week.advances.some((a) =>
    a.events.some((e) => e === 'DELOAD_REACTIVE' || e === 'BLOCK_ROTATED'),
  );
  const trigger: SyncTrigger | null =
    input.request?.trigger ??
    (missed.length > 0
      ? 'missed_day'
      : changes.length > 0
        ? blockMoved
          ? 'block'
          : 'unsafe'
        : added
          ? 'horizon'
          : null);

  return {
    from,
    week,
    statusUpdates,
    rows: week.days.map((d) => ({
      date: d.date,
      selection: d.selection,
      forecast: d.forecast,
      summary: d.summary,
      status: 'planned',
    })),
    changes,
    trigger,
  };
}

export type SyncTrigger =
  'horizon' | 'missed_day' | 'unsafe' | 'block' | 'manual' | 'constraint' | 'coach';

/**
 * What a day of the week is planned after: the history plus the days before it, done as planned.
 * The forecast stays out of the result of `planWeek`; this is how a reader of the week (the options
 * of a day for the coach) plans a single day the way the week would plan it.
 */
export function recordsBefore(
  week: WeekPlan,
  date: IsoDate,
  records: readonly ExposureRecord[],
  athlete: Athlete = FOLLOWS_THE_PLAN,
): ExposureRecord[] {
  const out = [...records];
  for (const day of week.days) {
    if (day.date >= date) break;
    if (day.forecast !== null) {
      out.push(...recordsOf(day.forecast, athlete, day.output!.phase === 'deload'));
    }
  }
  return out;
}
