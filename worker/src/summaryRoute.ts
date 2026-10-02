import { APICallError } from 'ai';

import { CONTRACT_VERSION } from '../../src/ai/contract/versions';
import {
  type ApiError,
  weeklySummaryRequestSchema,
  type WeeklySummaryResponse,
} from '../../src/ai/contract/weeklySummary';
import { WEEKLY_SUMMARY_PROMPT_VERSION } from '../../src/ai/prompts/weeklySummary/v1';
import type { Env } from './env';
import { admit, type Deps, json, STATUS, type Tracked } from './http';
import { estimateCostUsd, logRecord, type Outcome } from './log';
import { generateWeeklySummary, modelIdOf, type Tally } from './weeklySummary';

const respond = (body: WeeklySummaryResponse, status: number, headers?: Record<string, string>) =>
  json(body, status, headers);

/**
 * `POST /v1/weekly-summary`: context in, validated summary out, in one
 * response. Called after the secret has been checked.
 */
export async function handleWeeklySummary(
  request: Request,
  env: Env,
  deps: Deps,
  started: number,
): Promise<Response> {
  const track: Tracked = { requestId: null, modelId: null };
  let promptVersion: string | null = null;
  let attempts = 0;
  const tally: Tally = { inputTokens: 0, outputTokens: 0 };

  /** Every answer after authentication is logged here, once, as metadata. */
  function finish(response: Response, outcome: Outcome): Response {
    logRecord({
      event: 'weekly_summary',
      requestId: track.requestId,
      contractVersion: CONTRACT_VERSION,
      promptVersion,
      provider: env.PROVIDER,
      model: track.modelId,
      tokensIn: tally.inputTokens,
      tokensOut: tally.outputTokens,
      latencyMs: Date.now() - started,
      attempts,
      outcome,
      status: response.status,
      estimatedCostUsd: estimateCostUsd(tally.inputTokens, tally.outputTokens, env),
    });
    return response;
  }
  const reject = (error: ApiError, headers?: Record<string, string>) =>
    finish(respond(error, STATUS[error.kind], headers), 'rejected');

  const admission = await admit({
    request,
    env,
    deps,
    limiter: env.LIMITER,
    schema: weeklySummaryRequestSchema,
    track,
    modelIdOf,
    reject,
  });
  if (!admission.ok) return admission.response;
  const { data, model, maxOutputTokens, budget } = admission.admitted;

  // --- the call --------------------------------------------------------------
  const timeout = AbortSignal.timeout(deps.timeoutMs);
  try {
    const generation = await generateWeeklySummary(model, data.context, {
      abortSignal: AbortSignal.any([request.signal, timeout]),
      maxOutputTokens,
      tally,
    });
    attempts = generation.attempts;
    promptVersion = WEEKLY_SUMMARY_PROMPT_VERSION;
    track.modelId = generation.modelId;
    const usage = { inputTokens: tally.inputTokens, outputTokens: tally.outputTokens };

    if (generation.kind === 'invalid_output') {
      return finish(
        respond(
          {
            kind: 'invalid_output',
            requestId: data.requestId,
            promptVersion,
            attempts: generation.attempts,
            usage,
          },
          STATUS.invalid_output,
        ),
        'invalid_output',
      );
    }
    const repaired = generation.attempts > 1;
    return finish(
      respond(
        {
          kind: 'ok',
          requestId: data.requestId,
          promptVersion,
          model: generation.modelId,
          usage,
          validationOutcome: repaired ? 'ok_after_repair' : 'ok',
          summary: generation.summary,
        },
        200,
      ),
      repaired ? 'ok_after_repair' : 'ok',
    );
  } catch (error) {
    if (request.signal.aborted) {
      // The app closed the connection (the person left the screen). Nobody is listening.
      return finish(new Response(null, { status: 499 }), 'aborted');
    }
    if (timeout.aborted) return finish(respond({ kind: 'timeout' }, STATUS.timeout), 'timeout');
    const retryable = APICallError.isInstance(error) && error.isRetryable;
    return finish(
      respond({ kind: 'upstream_error', retryable }, STATUS.upstream_error),
      'upstream_error',
    );
  } finally {
    // Tokens are spent whether or not the answer was usable.
    await budget.spend(tally.inputTokens + tally.outputTokens);
  }
}
