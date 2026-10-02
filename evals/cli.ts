/**
 * `npm run eval` — run the evaluation cases and write a report.
 *
 *   npm run eval                              reference responders: no model, no key, what CI runs
 *   npm run eval -- --feature chat            only the chat (or weekly-summary)
 *   npm run eval -- --responder recorded --from evals/recorded/<run>
 *   npm run eval:live                         a real model; needs the provider key (see worker/README.md)
 *   npm run eval:compare -- before.json after.json
 *
 * Both features are run by default. Recorded and live runs keep the weekly
 * summary's answers directly in the directory and the chat's under `chat/`.
 *
 * Exits non-zero when a safety scorer fails on any case, or when a
 * comparison shows safety getting worse.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  recordedChatResponder,
  referenceChatResponder,
  type ChatResponder,
} from './chat/responders';
import { loadChatCases, runChatCases } from './chat/runner';
import {
  compareReports,
  reportSchema,
  renderComparison,
  renderMarkdown,
  type Report,
} from './report';
import { loadCases, runCases, type Responder } from './runner';
import { recordedResponder, referenceResponder } from './responders';

const CASES_DIR = join(__dirname, 'cases');
const FEATURES = ['weekly-summary', 'chat'] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function readReport(path: string): Report {
  return reportSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

function chooseFeatures(): readonly (typeof FEATURES)[number][] {
  const feature = arg('feature') ?? 'all';
  if (feature === 'all') return FEATURES;
  if ((FEATURES as readonly string[]).includes(feature))
    return [feature as (typeof FEATURES)[number]];
  throw new Error('--feature must be weekly-summary, chat or all');
}

const mode = () => arg('responder') ?? 'reference';

async function summaryResponder(): Promise<Responder> {
  switch (mode()) {
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

async function chatResponder(): Promise<ChatResponder> {
  switch (mode()) {
    case 'reference':
      return referenceChatResponder;
    case 'recorded': {
      const from = arg('from');
      if (!from)
        throw new Error('--responder recorded needs --from <directory of recorded answers>');
      return recordedChatResponder(join(from, 'chat'));
    }
    case 'live': {
      const { createLiveChatResponder } = await import('./chat/live');
      const record = arg('record');
      return createLiveChatResponder(record ? join(record, 'chat') : undefined);
    }
    default:
      throw new Error('--responder must be reference, recorded or live');
  }
}

async function runFeature(feature: (typeof FEATURES)[number]): Promise<Report> {
  if (feature === 'chat') {
    return runChatCases(loadChatCases(join(CASES_DIR, 'chat')), await chatResponder());
  }
  return runCases(loadCases(join(CASES_DIR, 'weekly-summary')), await summaryResponder());
}

function write(report: Report): void {
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
  process.stdout.write(`\nReport: ${join(out, name)}.{json,md}\n\n`);
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

  let code = 0;
  for (const feature of chooseFeatures()) {
    const report = await runFeature(feature);
    write(report);
    if (!report.safetyOk) code = 1;
  }
  return code;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
