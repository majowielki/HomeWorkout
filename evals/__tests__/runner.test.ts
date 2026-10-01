import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { WeeklySummary } from '@/ai/contract/weeklySummary';

import { buildCaseContext } from '../pipeline';
import {
  liveResponder,
  recordedResponder,
  referenceResponder,
  type Generation,
} from '../responders';
import { referenceAnswer } from '../responders/reference';
import { loadCases, runCase, runCases, type Responder } from '../runner';

const CASES = join(__dirname, '..', 'cases', 'weekly-summary');
const cases = loadCases(CASES);
const byId = (id: string) => cases.find((c) => c.id === id)!;

const NOW = () => new Date('2026-10-02T10:00:00.000Z');

describe('loadCases', () => {
  it('reads and validates every case, in a stable order', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(cases.map((c) => c.id)).toEqual([...cases.map((c) => c.id)].sort());
  });

  it('refuses a file that is not a case', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cases-'));
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ id: 'bad' }));
    expect(() => loadCases(dir)).toThrow();
  });

  it('ignores files that are not JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cases-'));
    writeFileSync(join(dir, 'notes.txt'), 'hello');
    expect(loadCases(dir)).toEqual([]);
  });
});

describe('buildCaseContext', () => {
  it('slips injected notes in after the gate, dated from the summary day', () => {
    const slip = byId('note-injury-slips-through');
    const context = buildCaseContext(slip);
    expect(context.notes.map((n) => n.text)).toEqual(['kolano strzyka przy schodzeniu ze schodów']);
    expect(context.notes[0]!.date).toBe('2026-09-30');
  });

  it('leaves the gate in force for ordinary cases', () => {
    expect(buildCaseContext(byId('note-injury-withheld')).notes).toEqual([]);
  });
});

describe('runCases with the reference responder', () => {
  it('passes every safety scorer on every case and says what it is', async () => {
    const report = await runCases(cases, referenceResponder, NOW);
    expect(report.safetyOk).toBe(true);
    expect(report.responder).toBe('reference');
    expect(report.model).toBe('reference-responder');
    expect(report.promptVersion).toBe('weekly-summary/v1');
    expect(report.createdAt).toBe('2026-10-02T10:00:00.000Z');
    expect(report.cases).toHaveLength(cases.length);
    expect(report.note).toMatch(/not a model/);
  });
});

describe('runCase', () => {
  it('records a responder that cannot answer as an error, never as a pass', async () => {
    const broken: Responder = { kind: 'live', respond: async () => ({ error: 'no key' }) };
    const run = await runCase(byId('typical-steady'), broken);
    expect(run).toMatchObject({ id: 'typical-steady', results: {}, error: 'no key' });
    expect((await runCases([byId('typical-steady')], broken, NOW)).safetyOk).toBe(false);
  });

  it('scores whatever comes back, even junk', async () => {
    const junk: Responder = { kind: 'live', respond: async () => ({ answer: 'not a summary' }) };
    const run = await runCase(byId('typical-steady'), junk);
    expect(run.results.schemaValid!.pass).toBe(false);
  });

  it('carries usage, latency and attempts through', async () => {
    const responder: Responder = {
      kind: 'live',
      respond: async (context) => ({
        answer: referenceAnswer(context),
        usage: { inputTokens: 100, outputTokens: 20 },
        latencyMs: 900,
        attempts: 2,
        model: 'm',
        promptVersion: 'p',
      }),
    };
    const report = await runCases([byId('typical-steady')], responder, NOW);
    expect(report.cases[0]).toMatchObject({
      usage: { inputTokens: 100, outputTokens: 20 },
      latencyMs: 900,
      attempts: 2,
    });
    expect(report).toMatchObject({ model: 'm', promptVersion: 'p' });
  });
});

describe('recordedResponder', () => {
  it('replays a saved answer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const evalCase = byId('typical-steady');
    const answer = referenceAnswer(buildCaseContext(evalCase));
    writeFileSync(
      join(dir, `${evalCase.id}.json`),
      JSON.stringify({ answer, model: 'recorded-model' }),
    );

    const report = await runCases([evalCase], recordedResponder(dir), NOW);
    expect(report).toMatchObject({
      responder: 'recorded',
      model: 'recorded-model',
      safetyOk: true,
    });
  });

  it('turns a missing recording into an error that names the case', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const run = await runCase(byId('typical-steady'), recordedResponder(dir));
    expect(run.error).toMatch(/no recording for typical-steady/);
  });
});

describe('liveResponder', () => {
  const summary: WeeklySummary = {
    headline: 'Dziewięć sesji.',
    highlights: ['Wszystko w porządku.'],
    flags: [],
    questions: [],
  };
  const generating =
    (generation: Generation) =>
    async (_c: unknown, tally: { inputTokens: number; outputTokens: number }) => {
      tally.inputTokens = 1000;
      tally.outputTokens = 100;
      return generation;
    };
  let clock = 0;
  const now = () => (clock += 50);

  it('returns the summary with what the call cost', async () => {
    const responder = liveResponder({
      now,
      generate: generating({ kind: 'ok', summary, attempts: 2, modelId: 'live-model' }),
    });
    const outcome = await responder.respond(
      buildCaseContext(byId('typical-steady')),
      byId('typical-steady'),
    );
    expect(outcome).toMatchObject({
      answer: summary,
      usage: { inputTokens: 1000, outputTokens: 100 },
      attempts: 2,
      model: 'live-model',
      promptVersion: 'weekly-summary/v1',
    });
    expect(responder.kind).toBe('live');
  });

  it('records an answer that failed validation twice as no summary, which the schema scorer fails', async () => {
    const responder = liveResponder({
      now,
      generate: generating({ kind: 'invalid_output', attempts: 2, modelId: 'live-model' }),
    });
    const run = await runCase(byId('typical-steady'), responder);
    expect(run.results.schemaValid!.pass).toBe(false);
  });

  it('records a call that threw as an error, with the reason', async () => {
    const responder = liveResponder({
      now,
      generate: async () => {
        throw new Error('503 from the provider');
      },
    });
    const run = await runCase(byId('typical-steady'), responder);
    expect(run.error).toBe('503 from the provider');
  });

  it('describes a non-Error throw generically', async () => {
    const responder = liveResponder({
      now,
      generate: async () => {
        throw 'boom';
      },
    });
    expect((await runCase(byId('typical-steady'), responder)).error).toBe('the call failed');
  });

  it('saves each answer for later replay when asked', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'live-')), 'nested');
    const responder = liveResponder({
      now,
      recordTo: dir,
      generate: generating({ kind: 'ok', summary, attempts: 1, modelId: 'live-model' }),
    });
    await runCase(byId('typical-steady'), responder);

    const saved = JSON.parse(readFileSync(join(dir, 'typical-steady.json'), 'utf8'));
    expect(saved).toMatchObject({ answer: summary, model: 'live-model' });

    // ...and what was saved replays to the same verdict.
    const replay = await runCases([byId('typical-steady')], recordedResponder(dir), NOW);
    expect(replay.cases[0]!.results.schemaValid!.pass).toBe(true);
    mkdirSync(dir, { recursive: true });
  });
});
