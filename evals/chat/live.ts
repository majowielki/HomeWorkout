/**
 * Wires the live chat responder to the Worker's real step code and the
 * provider named in the environment. Not exercised by any test: it needs a
 * key. The logic it delegates to is tested (`liveChatResponder` with a fake
 * `step`, the Worker's own suite), and what is here is only wiring.
 *
 * The Worker's modules are loaded by a path held in a variable, on purpose,
 * for the reason given in `evals/responders/live.ts`: the app's TypeScript
 * project does not install the Worker's packages. This file runs under
 * `tsx`; only this mode needs `npm ci` to have been run in `worker/`.
 *
 * Environment: PROVIDER=google, MODEL_ID, GOOGLE_GENERATIVE_AI_API_KEY and,
 * optionally, AI_GATEWAY_BASE_URL / AI_GATEWAY_TOKEN: the names the Worker
 * reads.
 */
import type { ChatEvent, ChatRequest } from '@/ai/contract/chat';

import { liveChatResponder, type ChatResponder } from './responders';
import { pacedFromEnv } from '../responders/pace';

interface WorkerModel {
  modelFromEnv(env: Record<string, string | undefined>): unknown | null;
  providerOptionsFromEnv(env: Record<string, string | undefined>): unknown;
}
interface WorkerChat {
  newStats(): unknown;
  streamChatStep(
    model: unknown,
    request: ChatRequest,
    options: {
      abortSignal: AbortSignal;
      maxOutputTokens: number;
      tally: { inputTokens: number; outputTokens: number };
      stats: unknown;
      providerOptions?: unknown;
    },
  ): AsyncGenerator<ChatEvent>;
}

const load = async <T>(specifier: string): Promise<T> => (await import(specifier)) as T;

/** The Worker's own per-step limit; a step that takes longer is a failure here too. */
const STEP_TIMEOUT_MS = 45_000;

export async function createLiveChatResponder(recordTo?: string): Promise<ChatResponder> {
  const { modelFromEnv, providerOptionsFromEnv } =
    await load<WorkerModel>('../../worker/src/model');
  const { streamChatStep, newStats } = await load<WorkerChat>('../../worker/src/chat');

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
  const model = pacedFromEnv(provided as object);

  return liveChatResponder({
    recordTo,
    async step(request) {
      const events: ChatEvent[] = [];
      try {
        for await (const event of streamChatStep(model, request, {
          abortSignal: AbortSignal.timeout(STEP_TIMEOUT_MS),
          maxOutputTokens: Number(process.env.MAX_OUTPUT_TOKENS ?? 2048),
          tally: { inputTokens: 0, outputTokens: 0 },
          stats: newStats(),
          providerOptions: providerOptionsFromEnv(env),
        })) {
          events.push(event);
        }
      } catch {
        // A provider failure ends the step like it ends one in production: as an error event.
        events.push({ type: 'error', error: { kind: 'upstream_error', retryable: false } });
      }
      return events;
    },
  });
}
