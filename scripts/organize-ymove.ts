/**
 * Applies the reviewed local assets/ymove-trial/selection.json once.
 * Every source record must have an exerciseId or an archive reason. The
 * relocation manifest preserves provenance and SHA-256 hashes of every file.
 * Videos, descriptions, translations and manifests remain gitignored.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import catalogue from '../data/exercises.json';

const ROOT = resolve(__dirname, '..', 'assets', 'ymove-trial');
const READY = join(ROOT, 'ready');
const ARCHIVE = join(ROOT, 'archive');

type Metadata = {
  slug: string;
  title: string;
  instructions: string[] | null;
  importantPoints: string[] | null;
  file?: string;
  videoFile?: string;
  bodyMapFile?: string;
  [key: string]: unknown;
};
type Translation = { instructions: string[]; importantPoints: string[] } | { hide: true };
type Selection = { source: string; key: string; exerciseId?: string; reason?: string };
type SourceRecord = {
  source: string;
  key: string;
  metadata: Metadata;
  video: string;
  bodyMap: string;
};
type Move = { from: string; to: string; sha256: string };

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** Restrict every move to the explicitly named asset directory. */
function local(file: string): string {
  const absolute = resolve(ROOT, file);
  const rel = relative(ROOT, absolute);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Path outside the asset directory: ${file}`);
  }
  return absolute;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function main(): void {
  if (existsSync(READY) || existsSync(ARCHIVE)) {
    throw new Error(
      'ready/ or archive/ already exists; use media:ymove to regenerate the app module.',
    );
  }
  const selection = readJson<Selection[]>(join(ROOT, 'selection.json'));
  const records: SourceRecord[] = [];
  for (const source of ['matched', 'new']) {
    const mapping = readJson<Record<string, Metadata>>(join(ROOT, source, 'mapping.json'));
    for (const [key, metadata] of Object.entries(mapping)) {
      records.push({
        source,
        key,
        metadata,
        video: `${source}/videos/${key}.mp4`,
        bodyMap: `${source}/body-map/${key}.svg`,
      });
    }
  }
  for (const metadata of readJson<Metadata[]>(join(ROOT, 'ymove-candidates', 'exercises.json'))) {
    records.push({
      source: 'ymove-candidates',
      key: metadata.slug,
      metadata,
      video: `ymove-candidates/${metadata.videoFile}`,
      bodyMap: `ymove-candidates/${metadata.bodyMapFile}`,
    });
  }
  for (const metadata of readJson<Metadata[]>(join(ROOT, 'exercises-full.json'))) {
    records.push({
      source: 'general',
      key: metadata.slug,
      metadata,
      video: metadata.file!,
      bodyMap: `body-map/${metadata.slug}.svg`,
    });
  }
  const translations: Record<string, Translation> = {};
  for (const file of readdirSync(join(ROOT, 'translations'))
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    Object.assign(translations, readJson(join(ROOT, 'translations', file)));
  }
  Object.assign(translations, readJson(join(ROOT, 'additional-translations.json')));

  const decisions = new Map(selection.map((s) => [`${s.source}/${s.key}`, s]));
  const recordKeys = new Set(records.map((r) => `${r.source}/${r.key}`));
  if (decisions.size !== selection.length || recordKeys.size !== records.length)
    throw new Error('Duplicate source key.');
  if (recordKeys.size !== decisions.size || [...decisions.keys()].some((k) => !recordKeys.has(k))) {
    throw new Error('Selection must cover every source record exactly once.');
  }
  const known = new Set(catalogue.exercises.map((e) => e.id));
  const mapping: Record<string, Metadata> = {};
  const polish: Record<string, Translation> = {};
  const archived: object[] = [];
  const moves: Move[] = [];
  const movedSources = new Set<string>();
  const destinations = new Set<string>();
  const planMove = (from: string, to: string) => {
    const source = local(from);
    const destination = local(to);
    if (!existsSync(source)) throw new Error(`Missing source: ${from}`);
    if (movedSources.has(from) || destinations.has(to) || existsSync(destination))
      throw new Error(`Move collision: ${from} -> ${to}`);
    movedSources.add(from);
    destinations.add(to);
    moves.push({ from, to, sha256: sha256(source) });
  };

  // Fully validate the decisions and every file before the first move.
  for (const r of records) {
    const decision = decisions.get(`${r.source}/${r.key}`)!;
    const id = decision.exerciseId;
    if (Boolean(id) === Boolean(decision.reason?.trim()))
      throw new Error(`Expected exactly one disposition for ${r.key}`);
    const prefix = id ? `ready` : `archive`;
    const assetId = id ?? `${r.source}-${r.key}`;
    const video = `${prefix}/videos/${assetId}.mp4`;
    const bodyMap = `${prefix}/body-map/${assetId}.svg`;
    planMove(r.video, video);
    planMove(r.bodyMap, bodyMap);
    const metadata = {
      ...r.metadata,
      source: r.source,
      sourceKey: r.key,
      videoFile: `videos/${assetId}.mp4`,
      bodyMapFile: `body-map/${assetId}.svg`,
    };
    if (id) {
      if (!known.has(id) || mapping[id]) throw new Error(`Unknown or duplicate exercise: ${id}`);
      const t = translations[id];
      if (
        !t ||
        'hide' in t ||
        t.instructions.length !== (r.metadata.instructions ?? []).length ||
        t.importantPoints.length !== (r.metadata.importantPoints ?? []).length
      ) {
        throw new Error(`Missing or misaligned Polish translation: ${id}`);
      }
      mapping[id] = metadata;
      polish[id] = t;
    } else {
      archived.push({ ...metadata, reason: decision.reason });
    }
  }
  const originalFiles = filesUnder(ROOT);
  for (const file of originalFiles) {
    const from = relative(ROOT, file).split(sep).join('/');
    if (movedSources.has(from) || from === 'selection.json') continue;
    planMove(from, `archive/originals/${from}`);
  }
  mkdirSync(ARCHIVE, { recursive: true });
  const manifest = { createdAt: new Date().toISOString(), verified: false, moves };
  const manifestFile = join(ARCHIVE, 'relocation.json');
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  for (const move of moves) {
    const target = local(move.to);
    mkdirSync(dirname(target), { recursive: true });
    renameSync(local(move.from), target);
  }
  for (const move of moves) {
    if (existsSync(local(move.from)) || sha256(local(move.to)) !== move.sha256)
      throw new Error(`Relocation verification failed: ${move.from}`);
  }
  writeFileSync(join(READY, 'mapping.json'), JSON.stringify(mapping, null, 2) + '\n');
  writeFileSync(join(READY, 'translations.json'), JSON.stringify(polish, null, 2) + '\n');
  writeFileSync(join(ARCHIVE, 'exercises.json'), JSON.stringify(archived, null, 2) + '\n');
  manifest.verified = true;
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    `${Object.keys(mapping).length} ready, ${archived.length} archived; ${moves.length} files moved and SHA-256 verified.`,
  );
}

main();
