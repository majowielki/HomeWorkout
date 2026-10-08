import { APICallError } from 'ai';

import { CONTRACT_VERSION } from '../../src/ai/contract/versions';
import type { ApiError } from '../../src/ai/contract/api';
import {
  voiceIntentRequestSchema,
  type VoiceIntentResponse,
} from '../../src/ai/contract/voiceIntent';
import { VOICE_INTENT_PROMPT_VERSION } from '../../src/ai/prompts/voiceIntent/v1';
import type { Env } from './env';
import { admit, type Deps, json, STATUS, type Tracked } from './http';
import { estimateCostUsd, logRecord, type Outcome } from './log';
import { providerOptionsFromEnv } from './model';
import { generateVoiceIntent } from './voiceIntent';
import { modelIdOf, type Tally } from './weeklySummary';

/** The answer is one word; a cap well under the summary's keeps a runaway model cheap. */
export const VOICE_MAX_OUTPUT_TOKENS = 512;

const respond = (body: VoiceIntentResponse, status: number, headers?: Record<string, string>) =>
  json(body, status, headers);

/**
 * `POST /v1/voice-intent`: a phrase the phone did not understand, and the
 * actions on screen; one of them (or `unknown`) back. Called after the
 * secret has been checked. Shares the chat's wider rate limit: both are
 * interactive and short.
 */
export async function handleVoiceIntent(
  request: Request,
  env: Env,
  deps: Deps,
  started: number,
): Promise<Response> {
  const track: Tracked = { requestId: null, modelId: null };
  let promptVersion: string | null = null;
  let upstreamStatus: number | undefined;
  const tally: Tally = { inputTokens: 0, outputTokens: 0 };

  function finish(response: Response, outcome: Outcome): Response {
    logRecord({
      event: 'voice_intent',
      requestId: track.requestId,
      contractVersion: CONTRACT_VERSION,
      promptVersion,
      provider: env.PROVIDER,
      model: track.modelId,
      tokensIn: tally.inputTokens,
      tokensOut: tally.outputTokens,
      latencyMs: Date.now() - started,
      attempts: promptVersion ? 1 : 0,
      outcome,
      status: response.status,
      estimatedCostUsd: estimateCostUsd(tally.inputTokens, tally.outputTokens, env),
      upstreamStatus,
    });
    return response;
  }
  const reject = (error: ApiError, headers?: Record<string, string>) =>
    finish(respond(error, STATUS[error.kind], headers), 'rejected');

  const admission = await admit({
    request,
    env,
    deps,
    limiter: env.CHAT_LIMITER,
    schema: voiceIntentRequestSchema,
    track,
    modelIdOf,
    reject,
  });
  if (!admission.ok) return admission.response;
  const { data, model, maxOutputTokens, budget } = admission.admitted;

  const timeout = AbortSignal.timeout(deps.voiceTimeoutMs);
  try {
    const generation = await generateVoiceIntent(model, data, {
      abortSignal: AbortSignal.any([request.signal, timeout]),
      maxOutputTokens: Math.min(maxOutputTokens, VOICE_MAX_OUTPUT_TOKENS),
      tally,
      providerOptions: providerOptionsFromEnv(env),
    });
    promptVersion = VOICE_INTENT_PROMPT_VERSION;
    track.modelId = generation.modelId;
    const validationOutcome = generation.valid ? 'ok' : 'invalid_output';
    return finish(
      respond(
        {
          kind: 'ok',
          requestId: data.requestId,
          promptVersion,
          model: generation.modelId,
          usage: { inputTokens: tally.inputTokens, outputTokens: tally.outputTokens },
          action: generation.action,
          validationOutcome,
        },
        200,
      ),
      validationOutcome,
    );
  } catch (error) {
    if (request.signal.aborted) return finish(new Response(null, { status: 499 }), 'aborted');
    if (timeout.aborted) return finish(respond({ kind: 'timeout' }, STATUS.timeout), 'timeout');
    const retryable = APICallError.isInstance(error) && error.isRetryable;
    if (APICallError.isInstance(error)) upstreamStatus = error.statusCode;
    return finish(
      respond({ kind: 'upstream_error', retryable }, STATUS.upstream_error),
      'upstream_error',
    );
  } finally {
    await budget.spend(tally.inputTokens + tally.outputTokens);
  }
}
