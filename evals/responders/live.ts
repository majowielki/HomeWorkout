/**
 * Wires the live responder to the Worker's real generation code and the
 * provider named in the environment. Not exercised by any test: it needs a
 * key. The logic it delegates to is tested (`liveResponder` with a fake
 * `generate`, the Worker's own suite), and what is here is deliberately
 * only wiring.
 *
 * The Worker's modules are loaded by a path held in a variable, on purpose.
 * The app's TypeScript project does not install the Worker's packages, and
 * a literal `import()` would make its typecheck (and CI's) reach into
 * `worker/node_modules`. This file runs under `tsx`, which resolves the path
 * at run time; only this mode needs `npm ci` to have been run in `worker/`.
 *
 * Environment: PROVIDER=google, MODEL_ID, GOOGLE_GENERATIVE_AI_API_KEY and,
 * optionally, AI_GATEWAY_BASE_URL / AI_GATEWAY_TOKEN: the names the Worker
 * reads.
 */
import type { CoachContext } from '@/ai/contract/coachContext';

import type { Responder } from '../runner';
import { liveResponder, type Generation } from './index';
import { pacedFromEnv } from './pace';

interface WorkerModel {
  modelFromEnv(env: Record<string, string | undefined>): unknown | null;
  providerOptionsFromEnv(env: Record<string, string | undefined>): unknown;
}
interface WorkerGeneration {
  generateWeeklySummary(
    model: unknown,
    context: CoachContext,
    options: {
      maxOutputTokens: number;
      tally: { inputTokens: number; outputTokens: number };
      providerOptions?: unknown;
    },
  ): Promise<Generation>;
}

const load = async <T>(specifier: string): Promise<T> => (await import(specifier)) as T;

export async function createLiveResponder(recordTo?: string): Promise<Responder> {
  const { modelFromEnv, providerOptionsFromEnv } =
    await load<WorkerModel>('../../worker/src/model');
  const { generateWeeklySummary } = await load<WorkerGeneration>('../../worker/src/weeklySummary');

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

  return liveResponder({
    now: Date.now,
    recordTo,
    generate: (context, tally) =>
      generateWeeklySummary(model, context, {
        maxOutputTokens: Number(process.env.MAX_OUTPUT_TOKENS ?? 2048),
        tally,
        providerOptions: providerOptionsFromEnv(env),
      }),
  });
}
