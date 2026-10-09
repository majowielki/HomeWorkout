/**
 * The week of the engine, from the database and back (engine, 04 §5, P5.1).
 *
 * One transaction reads the history, the block, the requests and the stored
 * days, lets `syncWeek` decide, and writes what changed: past days marked,
 * the days ahead replaced, and a generation that records why and what moved.
 * The block is not written here: it moves together with the session of the
 * day that is started (`acceptDay`).
 */
import { randomUUID } from 'expo-crypto';
import { and, desc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';
import { fingerprint } from '@/domain/fingerprint';
import { WEEK_CONFIG } from '@/domain/config/training';
import { planVersions } from '@/domain/plan/versions';
import {
  type StoredDayChange,
  type StoredDay,
  type SyncResult,
  syncWeek as planWeek,
  SyncTrigger,
} from '@/domain/plan/week';
import { addDays, trainingDate } from '@/domain/time/trainingDate';
import { db, type Tx } from '../client';
import type { PlanConstraint } from '@/domain/plan/constraints';
import type { WeekContext } from '@/ai/tools/planPreview';
import { planConstraints, plannedDays, planGenerations, workouts } from '../schema';
import { constraintRow } from './constraints';
import { readDayBoundaryHour, readPlanningInputs } from './planningInputs';
import { readSessionChangeSource } from './sessionChangeSource';
import type { SimulationBase } from '@/domain/session/simulateProposal';
import { readBlocks } from './trainingBlocks';

export interface WeekSyncRequest {
  /** An explicit request: plan from scratch from `from` (today or later). */
  request?: { trigger: 'manual' | 'constraint' | 'coach'; from?: string };
  horizonDays?: number;
}

export interface WeekSyncOutcome {
  result: SyncResult;
  asOf: string;
}

function storedDays(tx: Tx, from: string, to: string): StoredDay[] {
  return tx
    .select()
    .from(plannedDays)
    .where(and(gte(plannedDays.date, from), lte(plannedDays.date, to)))
    .orderBy(plannedDays.date)
    .all()
    .map((r) => ({
      date: r.date,
      selection: r.selection,
      forecast: r.forecast,
      summary: r.summary,
      status: r.status,
    }));
}

/**
 * Everything the week is planned from, read in the caller's transaction: the days and the history,
 * the block, the requests, the answers and the session of today when one is under way.
 */
export function readWeekBase(tx: Tx, now: Date, request: WeekSyncRequest['request'] = undefined) {
  const asOf = trainingDate(now, readDayBoundaryHour(tx));
  const { common, catalogVersion } = readPlanningInputs(tx, asOf);
  const { current, ended } = readBlocks(tx);
  const live = tx
    .select({ plan: workouts.sessionPlan, planSchema: workouts.planSchema })
    .from(workouts)
    .where(and(eq(workouts.status, 'in_progress'), eq(workouts.trainingDate, asOf)))
    .get();
  const snapshot = fingerprint({
    ...common,
    request: request ?? null,
    block: current?.state ?? null,
  });
  return {
    asOf,
    base: {
      catalog: common.catalog,
      slots: common.slots,
      eligibility: common.eligibility,
      block: current?.state ?? null,
      endedBlocks: ended,
      records: common.records,
      rides: common.rides,
      daily: common.daily,
      preferences: common.preferences,
      models: common.models,
      answers: common.answers,
      constraints: common.constraints,
      week: common.week,
      running: live?.planSchema === 2 ? live.plan : null,
      versions: planVersions(catalogVersion),
      snapshotFingerprint: snapshot,
    },
  };
}

/** Plans the week inside a transaction already open; writes nothing. */
export function planWeekIn(tx: Tx, req: WeekSyncRequest, now: Date): WeekSyncOutcome {
  const { asOf, base } = readWeekBase(tx, now, req.request);
  const back = addDays(asOf, -WEEK_CONFIG.lookBackDays);
  const trained = tx
    .select({ date: workouts.trainingDate })
    .from(workouts)
    .where(and(eq(workouts.status, 'completed'), gte(workouts.trainingDate, back)))
    .all();
  const result = planWeek({
    ...base,
    asOf,
    stored: storedDays(tx, back, addDays(asOf, WEEK_CONFIG.lookAheadDays)),
    trainedDates: new Set(trained.map((t) => t.date)),
    request: req.request,
    horizonDays: req.horizonDays,
  });
  return { result, asOf };
}

/**
 * The base of a simulation (11 §13): the week as it stands, read fresh, with the stored days that
 * still hold and, when a workout of engine is under way, that workout.
 */
export function loadSimulationBase(now: Date = new Date()): SimulationBase {
  return db.transaction((tx) => {
    const { asOf, base } = readWeekBase(tx, now);
    const kept = Object.fromEntries(
      storedDays(tx, asOf, addDays(asOf, WEEK_CONFIG.lookAheadDays)).flatMap((d) =>
        d.selection === null ? [] : [[d.date, d.selection]],
      ),
    );
    const live = base.running === null ? null : readSessionChangeSource(tx, base.running);
    return {
      ...base,
      asOf,
      kept,
      ...(live === null ? {} : { session: { snap: live.snap, state: live.session } }),
    };
  });
}

function writeWeek(
  tx: Tx,
  result: SyncResult,
  trigger: SyncTrigger,
  at: string,
  generationId: string,
): void {
  for (const u of result.statusUpdates) {
    tx.update(plannedDays)
      .set({ status: u.status, updatedAt: at })
      .where(eq(plannedDays.date, u.date))
      .run();
  }
  tx.insert(planGenerations)
    .values({
      id: generationId,
      createdAt: at,
      trigger,
      fromDate: result.from,
      changes: result.changes,
      seenAt: result.changes.length === 0 ? at : null,
    })
    .run();
  for (const row of result.rows) {
    const values = {
      selection: row.selection,
      forecast: row.forecast,
      summary: row.summary ?? null,
      status: row.status,
      generationId,
      updatedAt: at,
    };
    tx.insert(plannedDays)
      .values({ date: row.date, ...values })
      .onConflictDoUpdate({ target: plannedDays.date, set: values })
      .run();
  }
}

/**
 * Brings the stored week up to date and stores it. A look at the plan that
 * changes nothing writes nothing but the days' statuses.
 */
export function syncWeek(req: WeekSyncRequest = {}, now: Date = new Date()): WeekSyncOutcome {
  return db.transaction((tx) => {
    const outcome = planWeekIn(tx, req, now);
    const { result } = outcome;
    const at = now.toISOString();
    if (result.trigger === null) {
      for (const u of result.statusUpdates) {
        tx.update(plannedDays)
          .set({ status: u.status, updatedAt: at })
          .where(eq(plannedDays.date, u.date))
          .run();
      }
      // The choice stays; the forecast follows the history, which changes every day.
      for (const row of result.rows) {
        tx.update(plannedDays)
          .set({ forecast: row.forecast, summary: row.summary ?? null, updatedAt: at })
          .where(eq(plannedDays.date, row.date))
          .run();
      }
      return outcome;
    }
    writeWeek(tx, result, result.trigger, at, randomUUID());
    return outcome;
  });
}

/** The week as it would be planned now, for the person to look at. Writes nothing. */
export function previewWeek(req: WeekSyncRequest = {}, now: Date = new Date()): WeekSyncOutcome {
  return db.transaction((tx) => planWeekIn(tx, req, now));
}

/** The stored days between two dates, inclusive, oldest first. */
export function getWeek(from: string, to: string): StoredDay[] {
  return db.transaction((tx) => storedDays(tx, from, to));
}

export interface PlanBanner {
  id: string;
  trigger: SyncTrigger;
  createdAt: string;
  changes: StoredDayChange[];
}

/** The newest generation with changes the person has not closed yet. */
export function getUnseenChanges(): PlanBanner | null {
  const row = db
    .select()
    .from(planGenerations)
    .where(and(isNull(planGenerations.seenAt), ne(planGenerations.trigger, 'horizon')))
    .orderBy(desc(planGenerations.createdAt))
    .limit(1)
    .get();
  return row
    ? { id: row.id, trigger: row.trigger, createdAt: row.createdAt, changes: row.changes }
    : null;
}

/** Closes the banner — this generation and every older one. */
export function markChangesSeen(id: string, now: Date = new Date()): void {
  db.transaction((tx) => {
    const row = tx
      .select({ createdAt: planGenerations.createdAt })
      .from(planGenerations)
      .where(eq(planGenerations.id, id))
      .get();
    if (!row) return;
    tx.update(planGenerations)
      .set({ seenAt: now.toISOString() })
      .where(and(isNull(planGenerations.seenAt), lte(planGenerations.createdAt, row.createdAt)))
      .run();
  });
}

/** The week as it stands, read fresh, as the chat's plan tools take it. */
export function loadWeekContext(now: Date = new Date()): WeekContext {
  return db.transaction((tx) => {
    const { asOf, base } = readWeekBase(tx, now);
    const back = addDays(asOf, -WEEK_CONFIG.lookBackDays);
    const trained = tx
      .select({ date: workouts.trainingDate })
      .from(workouts)
      .where(and(eq(workouts.status, 'completed'), gte(workouts.trainingDate, back)))
      .all();
    return {
      ...base,
      asOf,
      stored: storedDays(tx, back, addDays(asOf, WEEK_CONFIG.lookAheadDays)),
      trainedDates: new Set(trained.map((t) => t.date)),
    };
  });
}

/**
 * The consent boundary of a request made through the coach: the requests, the ones they replace and the
 * week planned with them succeed or roll back together. The proposal is the generation, so accepting
 * it twice writes once.
 */
export function saveCoachWeek(
  proposalId: string,
  constraints: readonly PlanConstraint[],
  sync: SyncResult,
  replaced: readonly string[],
  now: Date = new Date(),
): boolean {
  return db.transaction((tx) => {
    if (
      tx
        .select({ id: planGenerations.id })
        .from(planGenerations)
        .where(eq(planGenerations.id, proposalId))
        .get()
    )
      return false;
    const at = now.toISOString();
    if (replaced.length > 0)
      tx.update(planConstraints)
        .set({ revokedAt: at })
        .where(inArray(planConstraints.id, [...replaced]))
        .run();
    for (const c of constraints) {
      tx.insert(planConstraints)
        .values(constraintRow({ ...c, source: 'coach' }, at))
        .run();
    }
    writeWeek(tx, sync, 'coach', at, proposalId);
    return true;
  });
}

/** Whether a workout is under way, of either engine: nothing is proposed over it. */
export function hasRunningWorkout(): boolean {
  return (
    db
      .select({ id: workouts.id })
      .from(workouts)
      .where(eq(workouts.status, 'in_progress'))
      .get() !== undefined
  );
}

/** The plan of the workout of engine under way on a day, if there is one. */
export function runningPlanOn(date: string) {
  return (
    db
      .select({ plan: workouts.sessionPlan })
      .from(workouts)
      .where(and(eq(workouts.status, 'in_progress'), eq(workouts.trainingDate, date)))
      .get()?.plan ?? null
  );
}

/** The plan frozen when a session of engine was started on a day (the main one, the first if several). */
export function startedPlanOn(date: string) {
  return (
    db
      .select({ plan: workouts.sessionPlan })
      .from(workouts)
      .where(and(eq(workouts.trainingDate, date), eq(workouts.planSchema, 2)))
      .orderBy(workouts.startedAt)
      .all()
      .map((r) => r.plan)
      .find((plan) => plan !== null && plan.kind === 'main') ?? null
  );
}
