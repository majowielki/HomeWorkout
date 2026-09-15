import { eq, inArray } from 'drizzle-orm';

import { db } from '../client';
import { exercises } from '../schema';

/*
 * The catalogue is reference data seeded from the bundle; screens read it
 * through `useLiveQuery` so an archived or re-versioned exercise updates
 * in place. These builders keep the SQL here, where the rest of it lives.
 */

export function liveExercisesQuery() {
  return db.select().from(exercises);
}

export function liveExerciseByIdQuery(id: string) {
  return db.select().from(exercises).where(eq(exercises.id, id)).limit(1);
}

/** Names for a list of ids; an empty list yields an empty result rather than an invalid `IN ()`. */
export function liveExerciseNamesQuery(ids: readonly string[]) {
  return db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises)
    .where(inArray(exercises.id, ids.length > 0 ? [...ids] : ['__none__']));
}
