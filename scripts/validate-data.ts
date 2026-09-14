/**
 * CI gate for the exercise catalogue and workout templates.
 *
 * The schemas cover shape; this covers the cross-record invariants that a
 * per-object schema cannot see — dangling substitutes/exerciseIds,
 * duplicate ids and missing media files.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import catalogue from '../data/exercises.json';
import { exerciseCatalogueSchema } from '../data/exercises.schema';
import templateCatalogue from '../data/templates.json';
import { templateCatalogueSchema } from '../data/templates.schema';

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

    if (exercise.media && !existsSync(join(MEDIA_DIR, `${exercise.media}-0.jpg`))) {
      errors.push(
        `${exercise.id}: media frame "${exercise.media}-0.jpg" is missing — run npm run media:import`,
      );
    }
  }

  // Every media key must correspond to a real exercise, or the require()
  // map in src/assets/exercise-media.ts would ship orphaned images.
  const mediaSources = JSON.parse(
    readFileSync(join(__dirname, '..', 'data', 'media-sources.json'), 'utf8'),
  ) as Record<string, string>;
  for (const key of Object.keys(mediaSources)) {
    if (key.startsWith('_')) continue;
    if (!ids.has(key)) {
      errors.push(`media-sources.json: "${key}" does not match any exercise id`);
    }
  }

  if (errors.length > 0) {
    console.error('exercise catalogue has problems:\n');
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }

  const parsedTemplates = templateCatalogueSchema.safeParse(templateCatalogue);
  if (!parsedTemplates.success) {
    console.error('templates.json does not match the schema:\n');
    for (const issue of parsedTemplates.error.issues) {
      console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    process.exit(1);
  }

  const templateErrors: string[] = [];
  const templateIds = new Set<string>();

  for (const template of parsedTemplates.data.templates) {
    if (templateIds.has(template.id)) {
      templateErrors.push(`duplicate template id: ${template.id}`);
    }
    templateIds.add(template.id);

    const labels = new Set<string>();
    for (const block of template.blocks) {
      if (labels.has(block.label)) {
        templateErrors.push(`${template.id}: duplicate block label "${block.label}"`);
      }
      labels.add(block.label);

      if (!ids.has(block.exerciseId)) {
        templateErrors.push(
          `${template.id}/${block.label}: exerciseId "${block.exerciseId}" does not exist`,
        );
      }
    }
  }

  if (templateErrors.length > 0) {
    console.error('templates.json has problems:\n');
    for (const error of templateErrors) console.error(`  ${error}`);
    process.exit(1);
  }

  const kneeLoading = exercises.filter((e) => e.loadsKnee).length;
  console.log(
    `exercises.json OK — ${exercises.length} exercises (v${parsed.data.version}), ` +
      `${kneeLoading} knee-loading, all substitutes resolve`,
  );
  console.log(
    `templates.json OK — ${parsedTemplates.data.templates.length} templates, ` +
      `all exerciseIds resolve`,
  );
}

main();
