/**
 * `npm run eval` — run the evaluation cases and write a report.
 *
 *   npm run eval                              reference responder: no model, no key, what CI runs
 *   npm run eval -- --responder recorded --from evals/recorded/<run>
 *   npm run eval:live                         a real model; needs the provider key (see worker/README.md)
 *   npm run eval:compare -- before.json after.json
 *
 * Exits non-zero when a safety scorer fails on any case, or when a
 * comparison shows safety getting worse.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  compareReports,
  reportSchema,
  renderComparison,
  renderMarkdown,
  type Report,
} from './report';
import { loadCases, runCases, type Responder } from './runner';
import { recordedResponder, referenceResponder } from './responders';

const CASES_DIR = join(__dirname, 'cases', 'weekly-summary');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function readReport(path: string): Report {
  return reportSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

async function chooseResponder(): Promise<Responder> {
  switch (arg('responder') ?? 'reference') {
    case 'reference':
      return referenceResponder;
    case 'recorded': {
      const from = arg('from');
      if (!from)
        throw new Error('--responder recorded needs --from <directory of recorded answers>');
      return recordedResponder(from);
    }
    case 'live': {
      // Loaded only here: the other modes must run with nothing installed in worker/.
      const { createLiveResponder } = await import('./responders/live');
      return createLiveResponder(arg('record'));
    }
    default:
      throw new Error('--responder must be reference, recorded or live');
  }
}

async function main(): Promise<number> {
  const compareIndex = process.argv.indexOf('--compare');
  if (compareIndex !== -1) {
    const [beforePath, afterPath] = process.argv.slice(compareIndex + 1);
    if (!beforePath || !afterPath) throw new Error('--compare needs two report files');
    const before = readReport(beforePath);
    const after = readReport(afterPath);
    const comparison = compareReports(before, after);
    process.stdout.write(renderComparison(before, after, comparison));
    return comparison.safetyRegressed ? 1 : 0;
  }

  const responder = await chooseResponder();
  const report = await runCases(loadCases(CASES_DIR), responder);

  const out = arg('out') ?? join(__dirname, 'reports');
  mkdirSync(out, { recursive: true });
  const stamp = report.createdAt.slice(0, 10);
  const name = [
    stamp,
    report.feature,
    report.responder,
    report.promptVersion?.split('/').pop(),
    report.model,
  ]
    .filter(Boolean)
    .join('-')
    .replace(/[^a-zA-Z0-9._-]+/g, '_');
  writeFileSync(join(out, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(out, `${name}.md`), renderMarkdown(report));

  process.stdout.write(renderMarkdown(report));
  process.stdout.write(`\nReport: ${join(out, name)}.{json,md}\n`);
  return report.safetyOk ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
