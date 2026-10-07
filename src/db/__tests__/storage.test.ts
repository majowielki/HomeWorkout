/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

it('uses real SQLite to verify atomic writes, calendar reads and backup restoration', () => {
  const result = spawnSync(
    process.execPath,
    ['--experimental-sqlite', path.join(__dirname, 'sqlite-check.cjs')],
    {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
      timeout: 15_000,
    },
  );
  if (result.status !== 0)
    throw new Error(`${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  expect(result.stdout).toContain('backup rollback and restore passed');
});
