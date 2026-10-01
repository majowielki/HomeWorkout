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
 * Loads the bundled reference data into SQLite on every app start.
 *
 * Everything runs in one transaction: a first launch that gets killed
 * halfway through must not leave a half-populated catalogue behind.
 *
 * - Exercises are upserted by id and gated on `version`; bumping the number
 *   in data/exercises.json pushes edits to an installed app without a
 *   migration. Rows are never deleted — set logs reference them — so an
 *   exercise dropped from the JSON is marked archived instead.
 * - Bands are inserted only when missing, so a calibration is never
 *   overwritten by a reseed.
 * - Templates are overwritten unconditionally. There is no in-app editor
 *   yet (planned for M10), so data/templates.json is the only author and
 *   version gating would just be ceremony.
 */
export async function seedDatabase(): Promise<void> {
  const parsed = exerciseCatalogueSchema.parse(catalogue);
  const parsedTemplates = templateCatalogueSchema.parse(templateCatalogue);
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await ensureProfile(now, tx);

    const existing = await tx
      .select({ id: exercises.id, dataVersion: exercises.dataVersion })
      .from(exercises);
    const versionById = new Map(existing.map((row) => [row.id, row.dataVersion]));

    for (const exercise of parsed.exercises) {
      const currentVersion = versionById.get(exercise.id);

      if (currentVersion === undefined) {
        await tx.insert(exercises).values({
          id: exercise.id,
          name: exercise.name,
          data: exercise,
          dataVersion: parsed.version,
        });
      } else if (currentVersion < parsed.version) {
        await tx
          .update(exercises)
          .set({ name: exercise.name, data: exercise, dataVersion: parsed.version })
          .where(eq(exercises.id, exercise.id));
      }
    }

    const shipped = new Set(parsed.exercises.map((e) => e.id));
    for (const row of existing) {
      if (shipped.has(row.id)) continue;
      const [stored] = await tx.select().from(exercises).where(eq(exercises.id, row.id)).limit(1);
      if (stored && !stored.data.archived) {
        await tx
          .update(exercises)
          .set({ data: { ...stored.data, archived: true } })
          .where(eq(exercises.id, row.id));
      }
    }

    const knownBands = new Set((await tx.select({ id: bands.id }).from(bands)).map((b) => b.id));
    for (const band of BANDS) {
      if (knownBands.has(band.id)) continue;
      await tx.insert(bands).values({
        id: band.id,
        label: band.label,
        nominalMinKg: band.nominalMinKg,
        nominalMaxKg: band.nominalMaxKg,
        calibration: null,
      });
    }

    const knownTemplates = new Set(
      (await tx.select({ id: workoutTemplates.id }).from(workoutTemplates)).map((t) => t.id),
    );
    for (const template of parsedTemplates.templates) {
      const values = {
        name: template.name,
        blocks: template.blocks,
        sortOrder: template.sortOrder,
        warmupMinutes: template.warmupMinutes ?? null,
      };
      if (knownTemplates.has(template.id)) {
        await tx.update(workoutTemplates).set(values).where(eq(workoutTemplates.id, template.id));
      } else {
        await tx.insert(workoutTemplates).values({ id: template.id, ...values });
      }
    }
  });
}
