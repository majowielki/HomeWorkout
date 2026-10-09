import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from 'ai';

import type { CoachContext } from '../../src/ai/contract/coachContext';
import { weeklySummarySchema, type WeeklySummary } from '../../src/ai/contract/weeklySummary';
import { buildWeeklySummaryPrompt } from '../../src/ai/prompts/weeklySummary/v3';
import { checkSummary, describeViolations } from '../../src/domain/coach/outputGuards';
import type { CallProviderOptions } from './model';
import { summaryWithReferral } from './reportedPain';

/** One try, and one more with the reason it failed. More would only spend tokens on a stuck model. */
export const MAX_ATTEMPTS = 2;

/** Tokens spent so far, filled in as calls finish so a failure further on does not lose them. */
export interface Tally {
  inputTokens: number;
  outputTokens: number;
}

export type Generation =
  | { kind: 'ok'; summary: WeeklySummary; attempts: number; modelId: string }
  | { kind: 'invalid_output'; attempts: number; modelId: string };

interface Options {
  abortSignal?: AbortSignal;
  maxOutputTokens: number;
  tally: Tally;
  providerOptions?: CallProviderOptions;
}

function add(tally: Tally, usage: { inputTokens?: number; outputTokens?: number } | undefined) {
  tally.inputTokens += usage?.inputTokens ?? 0;
  tally.outputTokens += usage?.outputTokens ?? 0;
}

export const modelIdOf = (model: LanguageModel) =>
  typeof model === 'string' ? model : model.modelId;

/**
 * F1: context in, validated summary out.
 *
 * Two independent checks stand between the model and the app. The schema
 * (through `Output.object`) fixes the shape; `checkSummary` fixes what the
 * words may say. Either failing earns one retry that carries the reason,
 * never the model's own text. After that, nothing is returned: a summary
 * that broke a rule is worse than no summary.
 *
 * Errors from the provider (network, quota, a 5xx) are not handled here;
 * they propagate so the handler can tell a retryable failure from a bad
 * answer.
 */
export async function generateWeeklySummary(
  model: LanguageModel,
  context: CoachContext,
  options: Options,
): Promise<Generation> {
  const built = buildWeeklySummaryPrompt(context, { format: 'structured' });
  const facts = {
    signals: context.signals,
    sparse: context.signals.includes('SPARSE_HISTORY'),
  };
  let note: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await generateText({
        model,
        instructions: built.instructions,
        prompt: note ? `${built.prompt}\n\n<previous_error>${note}</previous_error>` : built.prompt,
        output: Output.object({ schema: weeklySummarySchema }),
        temperature: 0.2,
        // The app retries, on the `retryable` flag we return. A second layer of
        // retries inside the SDK would hide latency and spend from both.
        maxRetries: 0,
        maxOutputTokens: options.maxOutputTokens,
        abortSignal: options.abortSignal,
        providerOptions: options.providerOptions,
      });
      add(options.tally, result.usage);

      const summary = summaryWithReferral(result.output, context);
      const violations = checkSummary(summary, facts);
      if (violations.length === 0) {
        return {
          kind: 'ok',
          summary,
          attempts: attempt,
          modelId: result.response.modelId,
        };
      }
      note = describeViolations(violations);
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) throw error;
      add(options.tally, error.usage);
      note =
        error.finishReason === 'length'
          ? 'the previous answer was cut off; keep it shorter'
          : error.message.slice(0, 300);
    }
  }

  return { kind: 'invalid_output', attempts: MAX_ATTEMPTS, modelId: modelIdOf(model) };
}
