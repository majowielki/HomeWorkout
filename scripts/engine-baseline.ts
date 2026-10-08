/**
 * The manifest of the engine baseline (engine v2, P0.1): which code, which
 * configuration, which catalogue and which golden snapshot a comparison
 * between stages is made against.
 *
 *   npx tsx scripts/engine-baseline.ts [--out Documents/silnik-v2/baseline/manifest.json]
 *
 * It records the revision AND the working-tree state: a commit hash alone
 * says nothing when files are modified on top of it (00 §1 of the plan).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  AUTOREGULATION_CONFIG,
  BLOCK_CONFIG,
  LAYOFF_FROM_DAYS,
  PLANNER_CONFIG,
  PROGRESSION_CONFIG,
  TRAINING_CONFIG,
  WEEK_CONFIG,
} from '../src/domain/config/training';

const root = path.resolve(__dirname, '..');
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).replace(/\r?\n$/, '');
const fileHash = (rel: string) => sha256(fs.readFileSync(path.join(root, rel)));

/** Stable text of a plain object: keys in order, so the same numbers always hash the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const configs = {
  planner: PLANNER_CONFIG,
  training: TRAINING_CONFIG,
  progression: PROGRESSION_CONFIG,
  autoregulation: AUTOREGULATION_CONFIG,
  block: BLOCK_CONFIG,
  week: WEEK_CONFIG,
  layoffFromDays: LAYOFF_FROM_DAYS,
};

const dirty = git('status', '--porcelain')
  .split('\n')
  .filter((line) => line !== '');

const manifest = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  git: {
    commit: git('rev-parse', 'HEAD'),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    dirtyFiles: dirty.length,
    dirty,
  },
  configs: Object.fromEntries(
    Object.entries(configs).map(([name, value]) => [name, sha256(canonical(value))]),
  ),
  catalogue: {
    'data/exercises.json': fileHash('data/exercises.json'),
    'data/slots.json': fileHash('data/slots.json'),
  },
  goldenSnapshot: {
    'src/domain/__tests__/__snapshots__/engineBaseline.test.ts.snap': fileHash(
      'src/domain/__tests__/__snapshots__/engineBaseline.test.ts.snap',
    ),
  },
};

const out = process.argv.indexOf('--out');
const text = `${JSON.stringify(manifest, null, 2)}\n`;
if (out !== -1) {
  const target = path.resolve(root, process.argv[out + 1] ?? 'engine-baseline.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
  console.log(`written ${path.relative(root, target)}`);
} else {
  console.log(text);
}
