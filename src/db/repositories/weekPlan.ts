import { randomUUID } from 'expo-crypto';

import { and, desc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';

import type { PlanConstraint } from '@/domain/plan/constraints';
import type { StoredDay, StoredDayChange, SyncTrigger } from '@/domain/plan/weekSync';

import { db } from '../client';
import { planConstraints, plannedDays, planGenerations, workouts } from '../schema';

/** The stored days between two dates, inclusive, oldest first. */
export async function getPlannedDays(from: string, to: string): Promise<StoredDay[]> {
  const rows = await db
    .select()
    .from(plannedDays)
    .where(and(gte(plannedDays.date, from), lte(plannedDays.date, to)))
    .orderBy(plannedDays.date);
  return rows.map((r) => ({
    date: r.date,
    selection: r.selection,
    forecast: r.forecast,
    status: r.status,
  }));
}

/** Training dates with a completed session, from a date on. */
export async function getTrainedDates(from: string): Promise<Set<string>> {
  const rows = await db
    .select({ date: workouts.trainingDate })
    .from(workouts)
    .where(and(eq(workouts.status, 'completed'), gte(workouts.trainingDate, from)));
  return new Set(rows.map((r) => r.date));
}

export interface WeekWrite {
  statusUpdates: { date: string; status: 'done' | 'missed' }[];
  rows: StoredDay[];
  trigger: SyncTrigger;
  fromDate: string;
  changes: StoredDayChange[];
}

/**
 * Stores a planned week in one transaction: past days marked, the days
 * from `fromDate` replaced, and a generation recording why and what
 * changed. A generation with no changes is born seen — no banner for it.
 */
export async function saveWeek(write: WeekWrite, now: Date = new Date()): Promise<void> {
  const at = now.toISOString();
  const generationId = randomUUID();
  await db.transaction(async (tx) => {
    for (const u of write.statusUpdates) {
      await tx
        .update(plannedDays)
        .set({ status: u.status, updatedAt: at })
        .where(eq(plannedDays.date, u.date));
    }
    await tx.insert(planGenerations).values({
      id: generationId,
      createdAt: at,
      trigger: write.trigger,
      fromDate: write.fromDate,
      changes: write.changes,
      seenAt: write.changes.length === 0 ? at : null,
    });
    for (const row of write.rows) {
      const values = {
        selection: row.selection,
        forecast: row.forecast,
        status: row.status,
        generationId,
        updatedAt: at,
      };
      await tx
        .insert(plannedDays)
        .values({ date: row.date, ...values })
        .onConflictDoUpdate({ target: plannedDays.date, set: values });
    }
  });
}

/** Marks past days only — when nothing else in the week changed. */
export async function markDays(
  updates: { date: string; status: 'done' | 'missed' }[],
  now: Date = new Date(),
): Promise<void> {
  if (updates.length === 0) return;
  const at = now.toISOString();
  await db.transaction(async (tx) => {
    for (const u of updates) {
      await tx
        .update(plannedDays)
        .set({ status: u.status, updatedAt: at })
        .where(eq(plannedDays.date, u.date));
    }
  });
}

export interface PlanBanner {
  id: string;
  trigger: SyncTrigger;
  createdAt: string;
  changes: StoredDayChange[];
}

/** The newest generation with changes the person has not closed yet — the banner on "Dziś". */
export async function getUnseenChanges(): Promise<PlanBanner | null> {
  const [row] = await db
    .select()
    .from(planGenerations)
    .where(and(isNull(planGenerations.seenAt), ne(planGenerations.trigger, 'horizon')))
    .orderBy(desc(planGenerations.createdAt))
    .limit(1);
  return row
    ? { id: row.id, trigger: row.trigger, createdAt: row.createdAt, changes: row.changes }
    : null;
}

/** Closes the banner — this generation and every older one. */
export async function markChangesSeen(id: string, now: Date = new Date()): Promise<void> {
  const [row] = await db
    .select({ createdAt: planGenerations.createdAt })
    .from(planGenerations)
    .where(eq(planGenerations.id, id))
    .limit(1);
  if (!row) return;
  await db
    .update(planGenerations)
    .set({ seenAt: now.toISOString() })
    .where(and(isNull(planGenerations.seenAt), lte(planGenerations.createdAt, row.createdAt)));
}

/** Requests that still apply on or after `from`, not taken back. */
export async function getActiveConstraints(from: string): Promise<PlanConstraint[]> {
  const rows = await db
    .select()
    .from(planConstraints)
    .where(and(isNull(planConstraints.revokedAt), gte(planConstraints.untilDate, from)));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    muscles: r.muscles,
    from: r.fromDate,
    until: r.untilDate,
    reason: r.reason,
    source: r.source,
    note: r.note,
  }));
}

export async function addConstraint(
  c: Omit<PlanConstraint, 'id'>,
  now: Date = new Date(),
): Promise<string> {
  const id = randomUUID();
  await db.insert(planConstraints).values({
    id,
    kind: c.kind,
    muscles: c.muscles,
    fromDate: c.from,
    untilDate: c.until,
    reason: c.reason,
    source: c.source,
    note: c.note,
    createdAt: now.toISOString(),
    revokedAt: null,
  });
  return id;
}

export async function revokeConstraints(ids: string[], now: Date = new Date()): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(planConstraints)
    .set({ revokedAt: now.toISOString() })
    .where(inArray(planConstraints.id, ids));
}

/**
 * The forecast of days that stay as chosen: their loads follow the logs,
 * which change every day, while the choice does not.
 */
export async function refreshForecasts(rows: StoredDay[], now: Date = new Date()): Promise<void> {
  const at = now.toISOString();
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .update(plannedDays)
        .set({ forecast: row.forecast, updatedAt: at })
        .where(eq(plannedDays.date, row.date));
    }
  });
}
