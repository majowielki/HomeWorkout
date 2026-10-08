/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/*
 * The repositories against real SQLite (sqlite-check.cjs, in a Node child:
 * Jest's RN environment has no native SQLite). The script runs once; each of
 * its cases, on its own fresh database, becomes a test here, so a failure
 * names the behaviour that broke.
 */
const run = spawnSync(
  process.execPath,
  ['--experimental-sqlite', path.join(__dirname, 'sqlite-check.cjs')],
  { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8', timeout: 30_000 },
);

interface CaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const lines = (run.stdout ?? '').split(/\r?\n/);
const declared = Number(lines.find((l) => l.startsWith('CASES '))?.slice(6) ?? NaN);
const results: CaseResult[] = lines
  .filter((l) => l.startsWith('RESULT '))
  .map((l) => JSON.parse(l.slice(7)) as CaseResult);

describe('storage on real SQLite', () => {
  it('runs every case to the end', () => {
    if (run.status !== 0 || results.length !== declared)
      throw new Error(`${run.error ?? ''}\n${run.stdout}\n${run.stderr}`);
    expect(results.length).toBeGreaterThan(10);
  });

  it.each(results.map((r) => [r.name, r] as const))('%s', (_, result) => {
    if (!result.ok) throw new Error(result.error);
  });
});
