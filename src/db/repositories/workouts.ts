import { randomUUID } from 'expo-crypto';

import { and, count, desc, eq, isNotNull, lt, ne } from 'drizzle-orm';

import { SESSION_CONFIG } from '@/domain/config/training';
import type { DaySelection, SessionPlan } from '@/domain/plan/types';
import { MS_PER_HOUR } from '@/domain/time/trainingDate';

import { db } from '../client';
import { plannedDays, setLogs, workouts } from '../schema';

export async function getWorkout(id: string) {
  const [row] = await db.select().from(workouts).where(eq(workouts.id, id)).limit(1);
  return row ?? null;
}

/** Most recent in-progress session, if any — offered as "resume" on app start. */
export async function findInProgressWorkout() {
  const [row] = await db
    .select()
    .from(workouts)
    .where(eq(workouts.status, 'in_progress'))
    .orderBy(desc(workouts.startedAt))
    .limit(1);
  return row ?? null;
}

export async function completeWorkout(
  id: string,
  sessionRpe: number | null,
  notes: string | null,
): Promise<void> {
  const at = new Date().toISOString();
  db.transaction((tx) => {
    tx.update(workouts)
      .set({ status: 'completed', finishedAt: at, sessionRpe, notes })
      .where(eq(workouts.id, id))
      .run();
    tx.update(plannedDays)
      .set({ status: 'done', updatedAt: at })
      .where(eq(plannedDays.workoutId, id))
      .run();
  });
}

export async function abandonWorkout(id: string): Promise<void> {
  const at = new Date().toISOString();
  db.transaction((tx) => {
    tx.update(workouts)
      .set({ status: 'abandoned', finishedAt: at })
      .where(eq(workouts.id, id))
      .run();
    tx.update(plannedDays)
      .set({ status: 'missed', updatedAt: at })
      .where(eq(plannedDays.workoutId, id))
      .run();
  });
}

/**
 * A session left "in_progress" for more than half a day was not resumed —
 * it was forgotten. Called once on app start so a stale row never blocks
 * starting a new one. See SPEC §7.1.
 */
export async function abandonStaleWorkouts(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(
    now.getTime() - SESSION_CONFIG.staleAfterHours * MS_PER_HOUR,
  ).toISOString();
  const at = now.toISOString();
  db.transaction((tx) => {
    const stale = and(eq(workouts.status, 'in_progress'), lt(workouts.startedAt, cutoff));
    const rows = tx.select({ id: workouts.id }).from(workouts).where(stale).all();
    tx.update(workouts).set({ status: 'abandoned', finishedAt: at }).where(stale).run();
    for (const row of rows) {
      tx.update(plannedDays)
        .set({ status: 'missed', updatedAt: at })
        .where(eq(plannedDays.workoutId, row.id))
        .run();
    }
  });
}

/** Freeze the extra session and its dated choice together; retries resume it. */
export async function startExtraWorkout(
  plan: SessionPlan,
  selection: DaySelection,
): Promise<string> {
  if (plan.kind !== 'extra' || plan.exercises.length === 0 || plan.date !== selection.date)
    throw new Error('Invalid extra session');
  return db.transaction((tx) => {
    const active = tx
      .select({ id: workouts.id })
      .from(workouts)
      .where(eq(workouts.status, 'in_progress'))
      .get();
    if (active) return active.id;
    const history = tx
      .select({ id: workouts.id })
      .from(workouts)
      .where(and(eq(workouts.trainingDate, plan.date), eq(workouts.status, 'completed')))
      .all();
    if (history.length === 0) throw new Error('Complete today first');
    const previous = tx
      .select({ seq: plannedDays.seq })
      .from(plannedDays)
      .where(eq(plannedDays.date, plan.date))
      .orderBy(desc(plannedDays.seq))
      .get();
    const seq = Math.max(2, (previous?.seq ?? 1) + 1, history.length + 1);
    const id = randomUUID();
    const at = new Date().toISOString();
    tx.insert(workouts)
      .values({
        id,
        templateId: null,
        trainingDate: plan.date,
        startedAt: at,
        status: 'in_progress',
        plan,
      })
      .run();
    tx.insert(plannedDays)
      .values({
        date: plan.date,
        seq,
        workoutId: id,
        selection,
        forecast: plan,
        status: 'planned',
        generationId: id,
        updatedAt: at,
      })
      .run();
    return id;
  });
}

/** Most recent completed session using this template, excluding `excludeId`. */
export async function findPreviousCompleted(templateId: string, excludeId: string) {
  const [row] = await db
    .select()
    .from(workouts)
    .where(
      and(
        eq(workouts.templateId, templateId),
        eq(workouts.status, 'completed'),
        ne(workouts.id, excludeId),
      ),
    )
    .orderBy(desc(workouts.startedAt))
    .limit(1);
  return row ?? null;
}

/** Most recently *completed* session — drives the rolling A/B alternation and "N days ago". */
export async function lastCompletedWorkout() {
  const [row] = await db
    .select()
    .from(workouts)
    .where(eq(workouts.status, 'completed'))
    .orderBy(desc(workouts.startedAt))
    .limit(1);
  return row ?? null;
}

export type WorkoutRow = typeof workouts.$inferSelect;

export interface WorkoutListItem extends WorkoutRow {
  workingSets: number;
}

/**
 * Every session, newest first, with its working-set count folded in. One
 * grouped query for the counts rather than one per row: the list grows by
 * a few rows a week for years and is read on every focus of the tab.
 */
export async function listWorkouts(): Promise<WorkoutListItem[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(workouts).orderBy(desc(workouts.startedAt)),
    db
      .select({ workoutId: setLogs.workoutId, n: count() })
      .from(setLogs)
      .where(eq(setLogs.isWarmup, false))
      .groupBy(setLogs.workoutId),
  ]);
  const byWorkout = new Map(counts.map((c) => [c.workoutId, c.n]));
  return rows.map((row) => ({ ...row, workingSets: byWorkout.get(row.id) ?? 0 }));
}

/** Removes the session and, through ON DELETE CASCADE, its set and cardio logs. */
export async function deleteWorkout(id: string): Promise<void> {
  await db.delete(workouts).where(eq(workouts.id, id));
}

/** Starts a session from the engine's plan, frozen into the row (SPEC §10.5). */
export async function startPlannedWorkout(
  plan: SessionPlan,
  trainingDate: string,
): Promise<string> {
  const id = randomUUID();
  await db.insert(workouts).values({
    id,
    templateId: null,
    trainingDate,
    startedAt: new Date().toISOString(),
    status: 'in_progress',
    plan,
  });
  return id;
}

/** The latest session of that training date that was started from a plan, if any. */
export async function findPlannedWorkoutOn(trainingDate: string) {
  const [row] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.trainingDate, trainingDate), isNotNull(workouts.plan)))
    .orderBy(desc(workouts.startedAt))
    .limit(1);
  return row ?? null;
}
