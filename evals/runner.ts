import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import type { CoachContext } from '@/ai/contract/coachContext';

import { buildCaseContext } from './pipeline';
import { buildReport, type CaseReport, type Report } from './report';
import { evalCaseSchema, type EvalCase } from './schema';
import { scoreAnswer } from './scorers';

export interface Answer {
  /** Parsed JSON as the model produced it: not yet trusted to be a summary. */
  answer: unknown;
  usage?: { inputTokens: number; outputTokens: number };
  latencyMs?: number;
  attempts?: number;
  /** Which prompt and model produced it, when the responder knows. */
  promptVersion?: string;
  model?: string;
}

/** Anything that can answer a case: the rule-based stand-in, a recording, a live model. */
export interface Responder {
  kind: Report['responder'];
  respond(context: CoachContext, evalCase: EvalCase): Promise<Answer | { error: string }>;
}

export function loadCases(dir: string): EvalCase[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => evalCaseSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8'))));
}

/**
 * One case, start to finish: build the context, ask the responder, score
 * the answer. A responder that cannot answer (no key, provider down) makes
 * the case an error, not a pass; the report marks it and safety fails.
 */
export async function runCase(
  evalCase: EvalCase,
  responder: Responder,
): Promise<CaseReport & { promptVersion?: string; model?: string }> {
  const context = buildCaseContext(evalCase);
  const outcome = await responder.respond(context, evalCase);
  if ('error' in outcome) {
    return { id: evalCase.id, category: evalCase.category, results: {}, error: outcome.error };
  }
  return {
    id: evalCase.id,
    category: evalCase.category,
    results: scoreAnswer({ evalCase, context, answer: outcome.answer }),
    usage: outcome.usage,
    latencyMs: outcome.latencyMs,
    attempts: outcome.attempts,
    promptVersion: outcome.promptVersion,
    model: outcome.model,
  };
}

export async function runCases(
  cases: readonly EvalCase[],
  responder: Responder,
  now: () => Date = () => new Date(),
): Promise<Report> {
  const runs = [];
  for (const evalCase of cases) runs.push(await runCase(evalCase, responder));

  const promptVersion = runs.find((r) => r.promptVersion)?.promptVersion ?? null;
  const model = runs.find((r) => r.model)?.model ?? null;
  return buildReport(
    { responder: responder.kind, promptVersion, model, createdAt: now().toISOString() },
    runs.map(({ promptVersion: _p, model: _m, ...report }) => report),
  );
}
