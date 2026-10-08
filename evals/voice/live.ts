/**
 * Wires the live voice responder to the Worker's own `generateVoiceIntent`
 * and the provider named in the environment. Not exercised by any test: it
 * needs a key. What it delegates to is tested (the runner with a fake
 * responder, the Worker's suite); this file is only wiring, loaded by a path
 * held in a variable for the reason given in `evals/responders/live.ts`.
 *
 * Environment: PROVIDER=google, MODEL_ID, GOOGLE_GENERATIVE_AI_API_KEY and,
 * optionally, AI_GATEWAY_BASE_URL / AI_GATEWAY_TOKEN / THINKING_LEVEL.
 */
import type { VoiceIntentRequest } from '@/ai/contract/voiceIntent';
import { VOICE_INTENT_PROMPT_VERSION } from '@/ai/prompts/voiceIntent/v1';

import { liveVoiceResponder, type VoiceResponder } from './runner';
import { describeError, pacedFromEnv } from '../responders/pace';

interface WorkerModel {
  modelFromEnv(env: Record<string, string | undefined>): unknown | null;
  providerOptionsFromEnv(env: Record<string, string | undefined>): unknown;
}
interface WorkerVoice {
  generateVoiceIntent(
    model: unknown,
    request: Pick<VoiceIntentRequest, 'transcript' | 'alternatives' | 'available'>,
    options: {
      abortSignal: AbortSignal;
      maxOutputTokens: number;
      tally: { inputTokens: number; outputTokens: number };
      providerOptions?: unknown;
    },
  ): Promise<{ action: string; valid: boolean; modelId: string }>;
}
interface WorkerVoiceRoute {
  VOICE_MAX_OUTPUT_TOKENS: number;
}

const load = async <T>(specifier: string): Promise<T> => (await import(specifier)) as T;

/** The Worker's own limit for this route. */
const VOICE_TIMEOUT_MS = 8_000;

/** The whole call including pacing and quota waits; the production limit applies per attempt (pace.ts). */
const RUN_LIMIT_MS = 5 * 60_000;

export async function createLiveVoiceResponder(recordTo?: string): Promise<VoiceResponder> {
  const { modelFromEnv, providerOptionsFromEnv } =
    await load<WorkerModel>('../../worker/src/model');
  const { generateVoiceIntent } = await load<WorkerVoice>('../../worker/src/voiceIntent');
  const { VOICE_MAX_OUTPUT_TOKENS } = await load<WorkerVoiceRoute>('../../worker/src/voiceRoute');

  const env = {
    PROVIDER: process.env.PROVIDER ?? 'google',
    MODEL_ID: process.env.MODEL_ID ?? '',
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    AI_GATEWAY_BASE_URL: process.env.AI_GATEWAY_BASE_URL,
    AI_GATEWAY_TOKEN: process.env.AI_GATEWAY_TOKEN,
    THINKING_LEVEL: process.env.THINKING_LEVEL,
  };
  const provided = modelFromEnv(env);
  if (!provided) {
    throw new Error(
      'No model: set PROVIDER, MODEL_ID and GOOGLE_GENERATIVE_AI_API_KEY (see worker/README.md).',
    );
  }
  // Under the provider's per-minute limit, with quota refusals waited out (pace.ts).
  const model = pacedFromEnv(provided as object, VOICE_TIMEOUT_MS);

  return liveVoiceResponder({
    recordTo,
    async call(request) {
      const started = Date.now();
      const tally = { inputTokens: 0, outputTokens: 0 };
      try {
        const generation = await generateVoiceIntent(model, request, {
          abortSignal: AbortSignal.timeout(RUN_LIMIT_MS),
          maxOutputTokens: Math.min(
            Number(process.env.MAX_OUTPUT_TOKENS ?? 2048),
            VOICE_MAX_OUTPUT_TOKENS,
          ),
          tally,
          providerOptions: providerOptionsFromEnv(env),
        });
        return {
          requestId: 'eval',
          latencyMs: Date.now() - started,
          result: {
            kind: 'ok',
            requestId: 'eval',
            promptVersion: VOICE_INTENT_PROMPT_VERSION,
            model: generation.modelId,
            usage: tally,
            action: generation.action as never,
            validationOutcome: generation.valid ? 'ok' : 'invalid_output',
          },
        };
      } catch (error) {
        return {
          requestId: 'eval',
          latencyMs: Date.now() - started,
          result: { kind: 'upstream_error', retryable: false },
          // Why, for the report: the class, the status and the first line of the message, never the key.
          detail: describeError(error),
        };
      }
    },
  });
}
