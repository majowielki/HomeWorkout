import { and, count, desc, eq, isNull, lt } from 'drizzle-orm';

import { SESSION_CONFIG } from '@/domain/config/training';
import { MS_PER_HOUR } from '@/domain/time/trainingDate';

import { db } from '../client';
import { closeSession } from './sessions';
import { setLogs, workouts } from '../schema';

export async function getWorkout(id: string) {
  const [row] = await db.select().from(workouts).where(eq(workouts.id, id)).limit(1);
  return row ?? null;
}

/** Most recent in-progress session, if any — offered as "resume" on app start. */
export async function findInProgressWorkout() {
  const [row] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.status, 'in_progress'), eq(workouts.planSchema, 2)))
    .orderBy(desc(workouts.startedAt))
    .limit(1);
  return row ?? null;
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
  {
    const rows = db
      .select()
      .from(workouts)
      .where(and(eq(workouts.status, 'in_progress'), lt(workouts.startedAt, cutoff)))
      .all();
    for (const row of rows) {
      if (row.planSchema === 2) {
        const result = closeSession(
          { commandId: 'stale/' + row.id, sessionId: row.id, how: 'abandoned' },
          now,
        );
        if (result.kind !== 'committed')
          throw new Error('Could not close stale session: ' + row.id);
      } else {
        db.update(workouts)
          .set({ status: 'abandoned', finishedAt: now.toISOString() })
          .where(eq(workouts.id, row.id))
          .run();
      }
    }
  }
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
      .where(and(eq(setLogs.isWarmup, false), isNull(setLogs.deletedAt)))
      .groupBy(setLogs.workoutId),
  ]);
  const byWorkout = new Map(counts.map((c) => [c.workoutId, c.n]));
  return rows.map((row) => ({ ...row, workingSets: byWorkout.get(row.id) ?? 0 }));
}

/** Removes the session and, through ON DELETE CASCADE, its set and cardio logs. */
export async function deleteWorkout(id: string): Promise<void> {
  await db.delete(workouts).where(eq(workouts.id, id));
}
