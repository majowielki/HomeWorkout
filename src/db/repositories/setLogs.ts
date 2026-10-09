import { and, eq, isNull } from 'drizzle-orm';

import { db } from '../client';
import { setLogs } from '../schema';

export type SetLogRow = typeof setLogs.$inferSelect;

/** The sets of a workout as stored; a result that was taken back stays as a tombstone and is no longer a set. */
export async function getSetsForWorkout(workoutId: string): Promise<SetLogRow[]> {
  return db
    .select()
    .from(setLogs)
    .where(and(eq(setLogs.workoutId, workoutId), isNull(setLogs.deletedAt)));
}

export function getSet(id: string): SetLogRow | null {
  return (
    db
      .select()
      .from(setLogs)
      .where(and(eq(setLogs.id, id), isNull(setLogs.deletedAt)))
      .get() ?? null
  );
}
