import { asc, eq } from 'drizzle-orm';

import { db } from '../client';
import { workoutTemplates } from '../schema';

export async function listActiveTemplates() {
  return db
    .select()
    .from(workoutTemplates)
    .where(eq(workoutTemplates.isArchived, false))
    .orderBy(asc(workoutTemplates.sortOrder));
}

export async function getTemplate(id: string) {
  const [row] = await db
    .select()
    .from(workoutTemplates)
    .where(eq(workoutTemplates.id, id))
    .limit(1);
  return row ?? null;
}

/** Archived ones included — history needs names for sessions of templates since retired. */
export async function listAllTemplates() {
  return db.select().from(workoutTemplates).orderBy(asc(workoutTemplates.sortOrder));
}
