/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/*
 * The repositories against real SQLite (sqlite-check.cjs and
 * sqlite-check-v2.cjs, in Node children: Jest's RN environment has no native
 * SQLite). Each script runs once; each of its cases, on its own fresh
 * database, becomes a test here, so a failure names the behaviour that broke.
 */
interface CaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const SCRIPTS = [
  ['storage on real SQLite', 'sqlite-check.cjs', 10],
  ['engine v2 storage on real SQLite', 'sqlite-check-v2.cjs', 15],
  ['P4b.4 session changes on real SQLite', 'sqlite-check-session-changes.cjs', 20],
  ['P5.5 the day of engine v2 on real SQLite', 'sqlite-check-planning-v2.cjs', 10],
  ['P5.1 the week of engine v2 on real SQLite', 'sqlite-check-week-v2.cjs', 8],
] as const;

for (const [title, script, atLeast] of SCRIPTS) {
  const run = spawnSync(process.execPath, ['--experimental-sqlite', path.join(__dirname, script)], {
    cwd: path.resolve(__dirname, '../../..'),
    encoding: 'utf8',
    timeout: 60_000,
  });
  const lines = (run.stdout ?? '').split(/\r?\n/);
  const declared = Number(lines.find((l) => l.startsWith('CASES '))?.slice(6) ?? NaN);
  const results: CaseResult[] = lines
    .filter((l) => l.startsWith('RESULT '))
    .map((l) => JSON.parse(l.slice(7)) as CaseResult);

  describe(title, () => {
    it('runs every case to the end', () => {
      if (run.status !== 0 || results.length !== declared)
        throw new Error(`${run.error ?? ''}\n${run.stdout}\n${run.stderr}`);
      expect(results.length).toBeGreaterThan(atLeast);
    });

    it.each(results.map((r) => [r.name, r] as const))('%s', (_, result) => {
      if (!result.ok) throw new Error(result.error);
    });
  });
}
