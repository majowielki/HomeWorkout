/**
 * CI gate for the exercise catalogue.
 *
 * The schema covers shape; this covers the cross-record invariants that a
 * per-object schema cannot see — dangling substitutes, duplicate ids and
 * missing media files.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import catalogue from '../data/exercises.json';
import { exerciseCatalogueSchema } from '../data/exercises.schema';

const MEDIA_DIR = join(__dirname, '..', 'assets', 'exercise-media');

function main(): void {
  const parsed = exerciseCatalogueSchema.safeParse(catalogue);

  if (!parsed.success) {
    console.error('exercises.json does not match the schema:\n');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    process.exit(1);
  }

  const { exercises } = parsed.data;
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const exercise of exercises) {
    if (ids.has(exercise.id)) {
      errors.push(`duplicate id: ${exercise.id}`);
    }
    ids.add(exercise.id);
  }

  for (const exercise of exercises) {
    for (const substitute of exercise.substituteIds) {
      if (!ids.has(substitute)) {
        errors.push(`${exercise.id}: substituteIds points at unknown exercise "${substitute}"`);
      }
      if (substitute === exercise.id) {
        errors.push(`${exercise.id}: listed as its own substitute`);
      }
    }

    if (exercise.media && !existsSync(join(MEDIA_DIR, `${exercise.media}.jpg`))) {
      errors.push(`${exercise.id}: media file "${exercise.media}.jpg" is missing`);
    }
  }

  if (errors.length > 0) {
    console.error('exercise catalogue has problems:\n');
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }

  const kneeLoading = exercises.filter((e) => e.loadsKnee).length;
  console.log(
    `exercises.json OK — ${exercises.length} exercises (v${parsed.data.version}), ` +
      `${kneeLoading} knee-loading, all substitutes resolve`,
  );
}

main();
