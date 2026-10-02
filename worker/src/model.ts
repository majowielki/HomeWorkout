import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel, streamText } from 'ai';

import type { Env } from './env';

/** What a call to `streamText` or `generateText` accepts as provider options. */
export type CallProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>;

const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;

/**
 * Provider settings that belong to a call rather than to the model: for Gemini,
 * how much it thinks. Anything but a known level is ignored, so a typo in the
 * configuration costs speed, not an outage.
 */
export function providerOptionsFromEnv(env: Pick<Env, 'PROVIDER' | 'THINKING_LEVEL'>) {
  const level = THINKING_LEVELS.find((l) => l === env.THINKING_LEVEL);
  if (env.PROVIDER !== 'google' || level === undefined) return undefined;
  return { google: { thinkingConfig: { thinkingLevel: level } } } satisfies CallProviderOptions;
}

/**
 * The one place that knows which provider is behind the Worker. Everything
 * else takes a `LanguageModel`, so retry, budget and guards are written
 * and tested once, not once per provider (AI-INTEGRACJA §7).
 *
 * Returns null when the configuration cannot produce a model, which the
 * handler reports as `misconfigured` rather than letting a provider error
 * out of an empty key.
 */
export function modelFromEnv(env: Env): LanguageModel | null {
  if (env.PROVIDER !== 'google') return null;
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY || !env.MODEL_ID) return null;

  const google = createGoogleGenerativeAI({
    apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
    // Through Cloudflare AI Gateway when configured: logs, spend analytics, limits.
    ...(env.AI_GATEWAY_BASE_URL ? { baseURL: env.AI_GATEWAY_BASE_URL } : {}),
    headers: {
      // The gateway keeps metadata (tokens, latency, status) but not what was said.
      'cf-aig-collect-log-payload': 'false',
      ...(env.AI_GATEWAY_TOKEN ? { 'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}` } : {}),
    },
  });
  return google(env.MODEL_ID);
}
