import { eq } from 'drizzle-orm';

import catalogue from '@data/exercises.json';
import { exerciseCatalogueSchema } from '@data/exercises.schema';
import templateCatalogue from '@data/templates.json';
import { templateCatalogueSchema } from '@data/templates.schema';
import { BANDS } from '@/domain/inventory';

import { db } from './client';
import { ensureProfile } from './repositories/profile';
import { bands, exercises, workoutTemplates } from './schema';

/**
 * Loads the bundled catalogue into SQLite.
 *
 * Exercises are upserted by id and gated on `version`, so editing
 * data/exercises.json and bumping the version updates an installed app
 * without writing a migration. Rows are never deleted — set logs point at
 * them — so an exercise dropped from the JSON is marked archived instead.
 */
export async function seedDatabase(): Promise<void> {
  await ensureProfile(new Date().toISOString());

  const parsed = exerciseCatalogueSchema.parse(catalogue);

  const existing = await db
    .select({ id: exercises.id, dataVersion: exercises.dataVersion })
    .from(exercises);
  const byId = new Map(existing.map((row) => [row.id, row.dataVersion]));

  for (const exercise of parsed.exercises) {
    const currentVersion = byId.get(exercise.id);

    if (currentVersion === undefined) {
      await db.insert(exercises).values({
        id: exercise.id,
        name: exercise.name,
        data: exercise,
        dataVersion: parsed.version,
      });
    } else if (currentVersion < parsed.version) {
      await db
        .update(exercises)
        .set({ name: exercise.name, data: exercise, dataVersion: parsed.version })
        .where(eq(exercises.id, exercise.id));
    }
  }

  const shipped = new Set(parsed.exercises.map((e) => e.id));
  for (const row of existing) {
    if (!shipped.has(row.id)) {
      const [stored] = await db.select().from(exercises).where(eq(exercises.id, row.id)).limit(1);
      if (stored && !stored.data.archived) {
        await db
          .update(exercises)
          .set({ data: { ...stored.data, archived: true } })
          .where(eq(exercises.id, row.id));
      }
    }
  }

  // Bands are fixed hardware; only insert the ones not present yet so a
  // user's calibration is never overwritten.
  const existingBands = await db.select({ id: bands.id }).from(bands);
  const knownBands = new Set(existingBands.map((b) => b.id));

  for (const band of BANDS) {
    if (!knownBands.has(band.id)) {
      await db.insert(bands).values({
        id: band.id,
        label: band.label,
        nominalMinKg: band.nominalMinKg,
        nominalMaxKg: band.nominalMaxKg,
        calibration: null,
      });
    }
  }

  // Templates upsert the same way as exercises: gated on version, never
  // deleted (workouts reference them), edits ship by bumping the version.
  const parsedTemplates = templateCatalogueSchema.parse(templateCatalogue);
  const existingTemplates = await db.select({ id: workoutTemplates.id }).from(workoutTemplates);
  const knownTemplates = new Set(existingTemplates.map((t) => t.id));

  for (const [index, template] of parsedTemplates.templates.entries()) {
    const values = {
      name: template.name,
      blocks: template.blocks,
      sortOrder: template.sortOrder ?? index,
      warmupMinutes: template.warmupMinutes ?? null,
    };
    if (knownTemplates.has(template.id)) {
      await db.update(workoutTemplates).set(values).where(eq(workoutTemplates.id, template.id));
    } else {
      await db.insert(workoutTemplates).values({ id: template.id, ...values });
    }
  }
}
