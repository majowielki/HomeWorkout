/**
 * The week of the second engine, from the database and back (engine v2, 04 §5, P5.1).
 *
 * One transaction reads the history, the block, the requests and the stored
 * days, lets `syncWeekV2` decide, and writes what changed: past days marked,
 * the days ahead replaced, and a generation that records why and what moved.
 * The block is not written here: it moves together with the session of the
 * day that is started (`acceptDay`).
 */
import { randomUUID } from 'expo-crypto';
import { and, desc, eq, gte, isNull, lte, ne } from 'drizzle-orm';
import { fingerprint } from '@/domain/fingerprint';
import { WEEK_CONFIG } from '@/domain/config/training';
import { planVersions } from '@/domain/plan/versions';
import {
  type StoredDayChangeV2,
  type StoredDayV2,
  type SyncResultV2,
  syncWeekV2,
} from '@/domain/plan/weekV2';
import type { SyncTrigger } from '@/domain/plan/weekSync';
import { addDays, trainingDate } from '@/domain/time/trainingDate';
import { db, type Tx } from '../client';
import { plannedDaysV2, planGenerationsV2, workouts } from '../schema';
import { readDayBoundaryHour, readPlanningInputs } from './planningInputs';
import { readBlocks } from './trainingBlocks';

export interface WeekSyncRequest {
  /** An explicit request: plan from scratch from `from` (today or later). */
  request?: { trigger: 'manual' | 'constraint' | 'coach'; from?: string };
  horizonDays?: number;
}

export interface WeekSyncOutcome {
  result: SyncResultV2;
  asOf: string;
}

function storedDays(tx: Tx, from: string, to: string): StoredDayV2[] {
  return tx
    .select()
    .from(plannedDaysV2)
    .where(and(gte(plannedDaysV2.date, from), lte(plannedDaysV2.date, to)))
    .orderBy(plannedDaysV2.date)
    .all()
    .map((r) => ({
      date: r.date,
      selection: r.selection,
      forecast: r.forecast,
      status: r.status,
    }));
}

/** Plans the week inside a transaction already open; writes nothing. */
export function planWeekIn(tx: Tx, req: WeekSyncRequest, now: Date): WeekSyncOutcome {
  const asOf = trainingDate(now, readDayBoundaryHour(tx));
  const { common, catalogVersion } = readPlanningInputs(tx, asOf);
  const { current, ended } = readBlocks(tx);
  const back = addDays(asOf, -WEEK_CONFIG.lookBackDays);
  const trained = tx
    .select({ date: workouts.trainingDate })
    .from(workouts)
    .where(and(eq(workouts.status, 'completed'), gte(workouts.trainingDate, back)))
    .all();
  const live = tx
    .select({ plan: workouts.planV2, planSchema: workouts.planSchema })
    .from(workouts)
    .where(and(eq(workouts.status, 'in_progress'), eq(workouts.trainingDate, asOf)))
    .get();
  const snapshot = fingerprint({
    ...common,
    request: req.request ?? null,
    block: current?.state ?? null,
  });
  const result = syncWeekV2({
    asOf,
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
    constraints: common.constraints,
    week: common.week,
    running: live?.planSchema === 2 ? live.plan : null,
    versions: planVersions(catalogVersion),
    snapshotFingerprint: snapshot,
    stored: storedDays(tx, back, addDays(asOf, WEEK_CONFIG.lookAheadDays)),
    trainedDates: new Set(trained.map((t) => t.date)),
    request: req.request,
    horizonDays: req.horizonDays,
  });
  return { result, asOf };
}

function writeWeek(
  tx: Tx,
  result: SyncResultV2,
  trigger: SyncTrigger,
  at: string,
  generationId: string,
): void {
  for (const u of result.statusUpdates) {
    tx.update(plannedDaysV2)
      .set({ status: u.status, updatedAt: at })
      .where(eq(plannedDaysV2.date, u.date))
      .run();
  }
  tx.insert(planGenerationsV2)
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
      status: row.status,
      generationId,
      updatedAt: at,
    };
    tx.insert(plannedDaysV2)
      .values({ date: row.date, ...values })
      .onConflictDoUpdate({ target: plannedDaysV2.date, set: values })
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
        tx.update(plannedDaysV2)
          .set({ status: u.status, updatedAt: at })
          .where(eq(plannedDaysV2.date, u.date))
          .run();
      }
      // The choice stays; the forecast follows the history, which changes every day.
      for (const row of result.rows) {
        tx.update(plannedDaysV2)
          .set({ forecast: row.forecast, updatedAt: at })
          .where(eq(plannedDaysV2.date, row.date))
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
export function getWeek(from: string, to: string): StoredDayV2[] {
  return db.transaction((tx) => storedDays(tx, from, to));
}

export interface PlanBannerV2 {
  id: string;
  trigger: SyncTrigger;
  createdAt: string;
  changes: StoredDayChangeV2[];
}

/** The newest generation with changes the person has not closed yet. */
export function getUnseenChanges(): PlanBannerV2 | null {
  const row = db
    .select()
    .from(planGenerationsV2)
    .where(and(isNull(planGenerationsV2.seenAt), ne(planGenerationsV2.trigger, 'horizon')))
    .orderBy(desc(planGenerationsV2.createdAt))
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
      .select({ createdAt: planGenerationsV2.createdAt })
      .from(planGenerationsV2)
      .where(eq(planGenerationsV2.id, id))
      .get();
    if (!row) return;
    tx.update(planGenerationsV2)
      .set({ seenAt: now.toISOString() })
      .where(and(isNull(planGenerationsV2.seenAt), lte(planGenerationsV2.createdAt, row.createdAt)))
      .run();
  });
}
