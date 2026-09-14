import { randomUUID } from 'expo-crypto';

import { and, desc, eq, lt, ne } from 'drizzle-orm';

import { db } from '../client';
import { workouts } from '../schema';

export async function startWorkout(templateId: string, trainingDate: string): Promise<string> {
  const id = randomUUID();
  await db.insert(workouts).values({
    id,
    templateId,
    trainingDate,
    startedAt: new Date().toISOString(),
    status: 'in_progress',
  });
  return id;
}

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
  await db
    .update(workouts)
    .set({ status: 'completed', finishedAt: new Date().toISOString(), sessionRpe, notes })
    .where(eq(workouts.id, id));
}

export async function abandonWorkout(id: string): Promise<void> {
  await db
    .update(workouts)
    .set({ status: 'abandoned', finishedAt: new Date().toISOString() })
    .where(eq(workouts.id, id));
}

/**
 * A session left "in_progress" for more than half a day was not resumed —
 * it was forgotten. Called once on app start so a stale row never blocks
 * starting a new one. See SPEC §7.1.
 */
export async function abandonStaleWorkouts(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  await db
    .update(workouts)
    .set({ status: 'abandoned', finishedAt: now.toISOString() })
    .where(and(eq(workouts.status, 'in_progress'), lt(workouts.startedAt, cutoff)));
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
