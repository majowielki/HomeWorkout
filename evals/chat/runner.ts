import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { runTurn, type TurnDeps } from '@/ai/chat/runTurn';
import { syntheticPlan } from '@/ai/testing/plan';
import { executeTool } from '@/ai/tools/execute';

import { buildReport, type CaseReport, type Report } from '../report';
import { prepareChatCase } from './pipeline';
import type { ChatResponder } from './responders';
import { CHAT_SAFETY_SCORERS, scoreChatTurn } from './scorers';
import { chatCaseSchema, type ChatCase } from './schema';

export function loadChatCases(dir: string): ChatCase[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => chatCaseSchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8'))));
}

type Run = CaseReport & { promptVersion?: string; model?: string };

/**
 * Failures that are the model's doing and so are scored. Every other failure
 * is the transport's (no network, a provider error, a refused key): the
 * case is an error, not a score, so a provider hiccup is not read as a safety
 * result and a model that always fails is not read as a safe one.
 */
const MODEL_FAILURES = new Set(['tool_limit', 'empty_reply', 'invalid_output']);

/**
 * One case, start to finish: build the history and the facts, put the
 * question through the real loop with the responder as the model, and score
 * what the person would have seen. A responder that cannot answer (no key,
 * a recording that ran out) makes the case an error, not a pass.
 */
export async function runChatCase(
  evalCase: ChatCase,
  responder: ChatResponder,
  now: () => number = Date.now,
): Promise<Run> {
  const failed = (error: string): Run => ({
    id: evalCase.id,
    category: evalCase.category,
    results: {},
    error,
  });

  const stepper = responder.forCase(evalCase);
  if ('error' in stepper) return failed(stepper.error);

  const { source, facts } = prepareChatCase(evalCase);
  let requests = 0;
  let ids = 0;
  const deps: TurnDeps = {
    stream: async (request, options) => {
      requests += 1;
      for (const event of await stepper.step(request)) {
        options.onEvent(event);
        if (event.type === 'error') return { kind: 'failed', failure: event.error };
        if (event.type === 'finish') return { kind: 'complete' };
      }
      return { kind: 'failed', failure: { kind: 'offline' } };
    },
    executeTool: (call) =>
      executeTool(call, {
        load: async () => source,
        plan: async (daysAgo) => syntheticPlan(source, daysAgo),
      }),
    newRequestId: () => `eval-${evalCase.id}-${(ids += 1)}`.slice(0, 64).padEnd(8, '0'),
    now,
  };

  try {
    const outcome = await runTurn({ facts, history: [], text: evalCase.question }, deps);
    if (outcome.kind === 'failed' && !MODEL_FAILURES.has(outcome.failure.kind)) {
      return failed(`no answer (${outcome.failure.kind})`);
    }
    return {
      id: evalCase.id,
      category: evalCase.category,
      results: scoreChatTurn({ evalCase, facts, outcome, requests }),
      usage: outcome.usage,
      latencyMs: outcome.latencyMs,
      attempts: outcome.requestIds.length,
      promptVersion: outcome.promptVersion ?? undefined,
      model: outcome.model ?? undefined,
    };
  } catch (error) {
    return failed(error instanceof Error ? error.message : 'the call failed');
  } finally {
    stepper.done?.();
  }
}

export async function runChatCases(
  cases: readonly ChatCase[],
  responder: ChatResponder,
  now: () => Date = () => new Date(),
): Promise<Report> {
  const runs: Run[] = [];
  for (const evalCase of cases) runs.push(await runChatCase(evalCase, responder));

  const promptVersion = runs.find((r) => r.promptVersion)?.promptVersion ?? null;
  const model = runs.find((r) => r.model)?.model ?? null;
  return buildReport(
    {
      feature: 'chat',
      safetyScorers: CHAT_SAFETY_SCORERS,
      responder: responder.kind,
      promptVersion,
      model,
      createdAt: now().toISOString(),
    },
    runs.map(({ promptVersion: _p, model: _m, ...report }) => report),
  );
}
