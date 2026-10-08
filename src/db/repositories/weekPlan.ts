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
    .where(and(eq(plannedDays.seq, 1), gte(plannedDays.date, from), lte(plannedDays.date, to)))
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
  db.transaction((tx) => {
    for (const u of write.statusUpdates) {
      tx.update(plannedDays)
        .set({ status: u.status, updatedAt: at })
        .where(and(eq(plannedDays.date, u.date), eq(plannedDays.seq, 1)))
        .run();
    }
    tx.insert(planGenerations)
      .values({
        id: generationId,
        createdAt: at,
        trigger: write.trigger,
        fromDate: write.fromDate,
        changes: write.changes,
        seenAt: write.changes.length === 0 ? at : null,
      })
      .run();
    for (const row of write.rows) {
      const values = {
        selection: row.selection,
        forecast: row.forecast,
        status: row.status,
        generationId,
        updatedAt: at,
      };
      tx.insert(plannedDays)
        .values({ date: row.date, ...values })
        .onConflictDoUpdate({ target: [plannedDays.date, plannedDays.seq], set: values })
        .run();
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
  db.transaction((tx) => {
    for (const u of updates) {
      tx.update(plannedDays)
        .set({ status: u.status, updatedAt: at })
        .where(and(eq(plannedDays.date, u.date), eq(plannedDays.seq, 1)))
        .run();
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

/** Replaces a calendar day's override atomically; leaves muscle restrictions intact. */
export async function setDayTraining(
  date: string,
  train: boolean,
  now: Date = new Date(),
): Promise<void> {
  const at = now.toISOString();
  db.transaction((tx) => {
    tx.update(planConstraints)
      .set({ revokedAt: at })
      .where(
        and(
          eq(planConstraints.fromDate, date),
          eq(planConstraints.untilDate, date),
          eq(planConstraints.source, 'user'),
          inArray(planConstraints.kind, ['rest_day', 'train_day']),
          isNull(planConstraints.revokedAt),
        ),
      )
      .run();
    tx.insert(planConstraints)
      .values({
        id: randomUUID(),
        kind: train ? 'train_day' : 'rest_day',
        muscles: [],
        fromDate: date,
        untilDate: date,
        reason: train ? 'other' : 'busy',
        source: 'user',
        note: null,
        createdAt: at,
        revokedAt: null,
      })
      .run();
  });
}

/**
 * The forecast of days that stay as chosen: their loads follow the logs,
 * which change every day, while the choice does not.
 */
export async function refreshForecasts(rows: StoredDay[], now: Date = new Date()): Promise<void> {
  const at = now.toISOString();
  db.transaction((tx) => {
    for (const row of rows) {
      tx.update(plannedDays)
        .set({ forecast: row.forecast, updatedAt: at })
        .where(and(eq(plannedDays.date, row.date), eq(plannedDays.seq, 1)))
        .run();
    }
  });
}
