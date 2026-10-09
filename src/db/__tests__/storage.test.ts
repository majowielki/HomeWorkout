/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/*
 * The repositories against real SQLite (sqlite-check.cjs and
 * sqlite-check-session.cjs, in Node children: Jest's RN environment has no native
 * SQLite). Each script runs once; each of its cases, on its own fresh
 * database, becomes a test here, so a failure names the behaviour that broke.
 */
interface CaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const SCRIPTS = [
  ['engine activation on real SQLite', 'sqlite-check-activation.cjs', 4],
  ['storage on real SQLite', 'sqlite-check.cjs', 8],
  ['engine storage on real SQLite', 'sqlite-check-session.cjs', 15],
  ['P4b.4 session changes on real SQLite', 'sqlite-check-session-changes.cjs', 20],
  ['P5.5 the day of engine on real SQLite', 'sqlite-check-planning.cjs', 10],
  ['P5.1 the week of engine on real SQLite', 'sqlite-check-week.cjs', 7],
  ['P5.4 the answers to the prescription on real SQLite', 'sqlite-check-answers.cjs', 5],
  ['P5.6 the model consults the running workout on real SQLite', 'sqlite-check-ai-session.cjs', 6],
  ['P5.6c the proposals of the chat on the week of engine', 'sqlite-check-proposals.cjs', 5],
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
