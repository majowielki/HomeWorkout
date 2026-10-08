import { CONTRACT_VERSION } from '../contract/versions';
import {
  voiceIntentRequestSchema,
  voiceIntentResponseSchema,
  type VoiceIntentOk,
  type VoiceIntentRequest,
} from '../contract/voiceIntent';
import type { ClientFailure } from './coachClient';
import type { CoachConfig } from './config';

/** Longer than the Worker's own 8 s, so its typed `timeout` normally arrives first. */
export const VOICE_CLIENT_TIMEOUT_MS = 10_000;

export type VoiceIntentResult = VoiceIntentOk | ClientFailure;

export interface VoiceCallOutcome {
  requestId: string;
  result: VoiceIntentResult;
  latencyMs: number;
}

export interface VoiceClientDeps {
  fetch: typeof fetch;
  now: () => number;
  newRequestId: () => string;
}

/**
 * One call, no retries: the person is waiting mid-set, and a second attempt
 * after a failure costs more time than saying the command again.
 */
export function createVoiceIntentClient(
  config: CoachConfig,
  deps: Pick<VoiceClientDeps, 'newRequestId'> & Partial<VoiceClientDeps>,
) {
  const d: VoiceClientDeps = { fetch: globalThis.fetch, now: Date.now, ...deps };

  return async function voiceIntent(
    input: Pick<VoiceIntentRequest, 'transcript' | 'alternatives' | 'available'>,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<VoiceCallOutcome> {
    const started = d.now();
    const requestId = d.newRequestId();
    const done = (result: VoiceIntentResult) => ({
      requestId,
      result,
      latencyMs: d.now() - started,
    });
    const body = JSON.stringify(
      voiceIntentRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId, ...input }),
    );
    if (options.signal?.aborted) return done({ kind: 'aborted' });

    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? VOICE_CLIENT_TIMEOUT_MS);

    try {
      const response = await d.fetch(`${config.baseUrl}/v1/voice-intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-secret': config.secret },
        body,
        signal: controller.signal,
      });
      const parsed = voiceIntentResponseSchema.safeParse(await response.json().catch(() => null));
      return done(parsed.success ? parsed.data : { kind: 'protocol_error' });
    } catch {
      if (options.signal?.aborted) return done({ kind: 'aborted' });
      return done(timedOut ? { kind: 'client_timeout' } : { kind: 'offline' });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  };
}

export type VoiceIntentCaller = ReturnType<typeof createVoiceIntentClient>;
