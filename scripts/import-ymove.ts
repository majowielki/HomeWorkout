/**
 * Turns the YMove clips downloaded into assets/ymove-trial/ into
 * src/assets/ymove-media.generated.ts, the module the app reads them from.
 *
 * YMove's licence covers the videos AND their metadata (descriptions, steps,
 * tips), only while a subscription is active, and forbids redistributing
 * them — so this output is gitignored together with the folder it reads. See
 * src/assets/ymove-media.ts for how the app copes when it is missing.
 *
 * Inputs, per source folder (matched/, new/):
 *   mapping.json       our exercise id -> what the API returned
 *   videos/<id>.mp4    the clip
 *   body-map/<id>.svg  the muscles-worked drawing
 * plus assets/ymove-trial/translations/*.json (optional, split only to keep
 * each file writable in one go): our exercise id -> { instructions,
 * importantPoints } in Polish, same length as the English. An entry of
 * { "hide": true } drops the English text for an exercise whose steps describe
 * a different movement than ours (the clip and muscle map stay).
 *
 * Only exercises that exist in data/exercises.json are emitted; the rest are
 * reported, so a clip can be downloaded before its exercise is added.
 *
 * Usage: npm run media:ymove
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import catalogue from '../data/exercises.json';

const ROOT = join(__dirname, '..');
const SOURCE_ROOT = join(ROOT, 'assets', 'ymove-trial');
const OUT_FILE = join(ROOT, 'src', 'assets', 'ymove-media.generated.ts');
const SOURCES = ['matched', 'new'] as const;
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

type Mapping = Record<
  string,
  {
    title: string;
    difficulty: string | null;
    muscleGroup: string;
    muscleGroups: string[] | null;
    secondaryMuscles: string[] | null;
    exerciseType: string[] | null;
    instructions: string[] | null;
    importantPoints: string[] | null;
  }
>;

type Translation = { instructions: string[]; importantPoints: string[] } | { hide: true };
type Translations = Record<string, Translation>;

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null;
}

function readTranslations(problems: string[]): Translations {
  const dir = join(SOURCE_ROOT, 'translations');
  const merged: Translations = {};
  if (!existsSync(dir)) return merged;
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const part = readJson<Translations>(join(dir, file)) ?? {};
    for (const [id, t] of Object.entries(part)) {
      if (id in merged) problems.push(`${id}: translated in more than one file (${file})`);
      merged[id] = t;
    }
  }
  return merged;
}

function main(): void {
  const knownIds = new Set(
    (catalogue as { exercises: { id: string }[] }).exercises.map((e) => e.id),
  );

  const entries: string[] = [];
  const emitted = new Set<string>();
  const waiting: string[] = [];
  const problems: string[] = [];
  const translations = readTranslations(problems);
  const hidden = new Set<string>();

  for (const source of SOURCES) {
    const mapping = readJson<Mapping>(join(SOURCE_ROOT, source, 'mapping.json'));
    if (!mapping) continue;

    for (const [id, m] of Object.entries(mapping).sort(([a], [b]) => a.localeCompare(b))) {
      if (!knownIds.has(id)) {
        waiting.push(`${source}/${id}`);
        continue;
      }
      const video = join(SOURCE_ROOT, source, 'videos', `${id}.mp4`);
      const bodyMap = join(SOURCE_ROOT, source, 'body-map', `${id}.svg`);
      if (!existsSync(video) || !existsSync(bodyMap)) {
        problems.push(`${id}: clip or body map missing in ${source}/`);
        continue;
      }
      if (emitted.has(id)) {
        problems.push(`${id}: present in more than one source folder`);
        continue;
      }

      const t = translations[id];
      const hide = t !== undefined && 'hide' in t;
      if (hide) hidden.add(id);
      const english = {
        instructions: hide ? [] : (m.instructions ?? []),
        importantPoints: hide ? [] : (m.importantPoints ?? []),
      };
      const pl = t !== undefined && !('hide' in t) ? t : undefined;
      const plOk =
        pl !== undefined &&
        pl.instructions.length === english.instructions.length &&
        pl.importantPoints.length === english.importantPoints.length;
      if (pl !== undefined && !plOk) {
        problems.push(`${id}: translation does not line up with the English steps/tips`);
      }

      const info = {
        title: m.title,
        difficulty: m.difficulty && DIFFICULTIES.includes(m.difficulty) ? m.difficulty : null,
        muscleGroup: m.muscleGroup,
        muscleGroups: m.muscleGroups ?? [],
        secondaryMuscles: m.secondaryMuscles ?? [],
        exerciseType: m.exerciseType ?? [],
        ...english,
        ...(plOk ? { pl } : {}),
      };

      const req = (abs: string) =>
        `require('${relative(join(ROOT, 'src', 'assets'), abs).replace(/\\/g, '/')}')`;
      entries.push(
        `  ${JSON.stringify(id)}: { video: ${req(video)}, bodyMap: ${req(bodyMap)}, info: ${JSON.stringify(info)} },`,
      );
      emitted.add(id);
    }
  }

  const lines = [
    '// GENERATED by scripts/import-ymove.ts — do not edit by hand, do not commit.',
    '// YMove content is licensed for the length of the subscription only.',
    '',
    "import type { YmoveEntry } from './ymove-media.types';",
    '',
    'export const ymoveMedia: Record<string, YmoveEntry> = {',
    ...entries,
    '};',
    '',
  ];
  writeFileSync(OUT_FILE, lines.join('\n'));

  const translated = [...emitted].filter((id) => translations[id] && !hidden.has(id)).length;
  console.log(
    `${emitted.size} exercises -> ${relative(ROOT, OUT_FILE)} (${translated} with a Polish translation, ${hidden.size} with the text hidden)`,
  );
  const untranslated = [...emitted].filter((id) => !translations[id]);
  if (untranslated.length > 0) {
    console.log(`${untranslated.length} still in English only: ${untranslated.join(', ')}`);
  }
  const without = [...knownIds].filter((id) => !emitted.has(id));
  console.log(`${without.length} catalogue exercises have no YMove clip: ${without.join(', ')}`);
  if (waiting.length > 0) {
    console.log(
      `${waiting.length} downloaded clips wait for their exercise: ${waiting.join(', ')}`,
    );
  }
  if (problems.length > 0) {
    console.error('\nproblems:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
}

main();
