import { isAuthorized } from './auth';
import type { Env } from './env';
import {
  CHAT_TIMEOUT_MS,
  type Deps,
  GENERATION_TIMEOUT_MS,
  json,
  MAX_BODY_BYTES,
  VOICE_TIMEOUT_MS,
} from './http';
import { modelFromEnv } from './model';
import { handleChat } from './chatRoute';
import { handleWeeklySummary } from './summaryRoute';
import { handleVoiceIntent } from './voiceRoute';

export type { Env } from './env';
export { CHAT_TIMEOUT_MS, GENERATION_TIMEOUT_MS, MAX_BODY_BYTES, VOICE_TIMEOUT_MS };
export type { Deps };

const ROUTES = new Set(['/v1/weekly-summary', '/v1/chat', '/v1/voice-intent']);

/**
 * The Worker, with its dependencies injectable. Tests pass a mock model and
 * a fixed clock; `src/dev.ts` passes a fake model so the app can be run end
 * to end without a provider key; production uses the defaults.
 *
 * Routing is by exact method and path; anything else is a 404 before the
 * secret is even looked at. Every route is authenticated the same way, and
 * a refusal at that point is the one answer that is not logged: a caller
 * without the secret has not earned a log line.
 */
export function createHandler(overrides: Partial<Deps> = {}): ExportedHandler<Env> {
  const deps: Deps = {
    model: modelFromEnv,
    now: () => new Date(),
    timeoutMs: GENERATION_TIMEOUT_MS,
    chatTimeoutMs: CHAT_TIMEOUT_MS,
    voiceTimeoutMs: VOICE_TIMEOUT_MS,
    ...overrides,
  };

  return {
    async fetch(request, env, ctx): Promise<Response> {
      const started = Date.now();
      const { pathname } = new URL(request.url);
      if (request.method !== 'POST' || !ROUTES.has(pathname)) {
        return json({ kind: 'not_found' }, 404);
      }
      if (!isAuthorized(request, env.APP_SECRET)) return json({ kind: 'unauthorized' }, 401);
      if (pathname === '/v1/chat') return handleChat(request, env, deps, ctx, started);
      if (pathname === '/v1/voice-intent') return handleVoiceIntent(request, env, deps, started);
      return handleWeeklySummary(request, env, deps, started);
    },
  } satisfies ExportedHandler<Env>;
}

export default createHandler();
