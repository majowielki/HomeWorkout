import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { WEEKLY_SUMMARY_PROMPT_VERSION } from '@/ai/prompts/weeklySummary/v3';
import type { CoachContext } from '@/ai/contract/coachContext';
import type { WeeklySummary } from '@/ai/contract/weeklySummary';

import type { Answer, Responder } from '../runner';
import { REFERENCE_MODEL, referenceAnswer } from './reference';

/** The rule-based stand-in. Deterministic, instant, free: what CI runs on every push. */
export const referenceResponder: Responder = {
  kind: 'reference',
  async respond(context) {
    return {
      answer: referenceAnswer(context),
      promptVersion: WEEKLY_SUMMARY_PROMPT_VERSION,
      model: REFERENCE_MODEL,
    };
  },
};

/** Answers saved by an earlier live run, replayed without a network. */
export function recordedResponder(dir: string): Responder {
  return {
    kind: 'recorded',
    async respond(_context, evalCase) {
      try {
        return JSON.parse(readFileSync(join(dir, `${evalCase.id}.json`), 'utf8')) as Answer;
      } catch {
        return { error: `no recording for ${evalCase.id} in ${dir}` };
      }
    },
  };
}

/** What the Worker's `generateWeeklySummary` returns, as far as the runner cares. */
export type Generation =
  | { kind: 'ok'; summary: WeeklySummary; attempts: number; modelId: string }
  | { kind: 'invalid_output'; attempts: number; modelId: string };

export interface LiveDeps {
  /** Calls the model through the very code the Worker runs. Injected so it can be faked. */
  generate: (
    context: CoachContext,
    tally: { inputTokens: number; outputTokens: number },
  ) => Promise<Generation>;
  now: () => number;
  /** Where to save each answer for later replay, if anywhere. */
  recordTo?: string;
}

/**
 * A real model, called through the Worker's own generation code, so the
 * evaluation measures what production runs, including the schema check,
 * the output guards and the one repair.
 *
 * An answer that failed validation twice is recorded as a missing summary,
 * which the schema scorer then fails. That is the honest result: in
 * production the person would have got nothing.
 */
export function liveResponder(deps: LiveDeps): Responder {
  return {
    kind: 'live',
    async respond(context, evalCase) {
      const tally = { inputTokens: 0, outputTokens: 0 };
      const started = deps.now();
      try {
        const generation = await deps.generate(context, tally);
        const answer: Answer = {
          answer: generation.kind === 'ok' ? generation.summary : null,
          usage: tally,
          latencyMs: deps.now() - started,
          attempts: generation.attempts,
          promptVersion: WEEKLY_SUMMARY_PROMPT_VERSION,
          model: generation.modelId,
        };
        if (deps.recordTo) {
          const file = join(deps.recordTo, `${evalCase.id}.json`);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, JSON.stringify(answer, null, 2) + '\n');
        }
        return answer;
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'the call failed' };
      }
    },
  };
}
