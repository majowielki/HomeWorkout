import type { CoachContext } from '../contract/coachContext';
import { CONTRACT_VERSION } from '../contract/versions';
import {
  type ApiError,
  weeklySummaryRequestSchema,
  weeklySummaryResponseSchema,
  type WeeklySummaryOk,
} from '../contract/weeklySummary';
import type { CoachConfig } from './config';

/**
 * Every way a call can end, as one union the screen switches over. The
 * Worker's own errors come first; the four after them are things only the
 * client can see.
 */
export type ClientFailure =
  | ApiError
  /** No answer at all: no network, a refused connection, a dropped one. */
  | { kind: 'offline' }
  /** The client's own limit ran out before an answer came. */
  | { kind: 'client_timeout' }
  /** The person left or pressed cancel. Not an error. */
  | { kind: 'aborted' }
  /** An answer came, but not one this version of the app understands. */
  | { kind: 'protocol_error' };

export type SummaryResult = WeeklySummaryOk | ClientFailure;

export interface CallOutcome {
  /** The id this call carried, so a failure that never got an answer can still be logged. */
  requestId: string;
  result: SummaryResult;
  /** Calls made, 1 to MAX_RETRIES + 1. */
  attempts: number;
  latencyMs: number;
}

export interface ClientDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** In [0, 1). Spreads retries so two clients do not hit a struggling server together. */
  random: () => number;
  now: () => number;
  newRequestId: () => string;
}

/** Retries after the first attempt, and only for a failure the Worker marked as worth repeating. */
export const MAX_RETRIES = 2;
export const BASE_BACKOFF_MS = 500;
/** Longer than the Worker's own 25 s, so its typed `timeout` normally arrives first. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Exponential with jitter: 0.25-0.75 s, then 0.5-1.5 s. */
export function backoffMs(retry: number, random: () => number): number {
  return BASE_BACKOFF_MS * 2 ** (retry - 1) * (0.5 + random());
}

export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * HTTP client for the Worker. `fetch`, the clock and the dice are
 * parameters, so every path is tested without a network and without a
 * mocking library (AI-INTEGRACJA §8).
 */
export function createCoachClient(
  config: CoachConfig,
  deps: Pick<ClientDeps, 'newRequestId'> & Partial<ClientDeps>,
) {
  const d: ClientDeps = {
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
    now: Date.now,
    ...deps,
  };

  async function attempt(body: string, options: CallOptions): Promise<SummaryResult> {
    // Already cancelled: do not even open a connection.
    if (options.signal?.aborted) return { kind: 'aborted' };

    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      const response = await d.fetch(`${config.baseUrl}/v1/weekly-summary`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-secret': config.secret },
        body,
        signal: controller.signal,
      });
      const parsed = weeklySummaryResponseSchema.safeParse(await response.json().catch(() => null));
      return parsed.success ? parsed.data : { kind: 'protocol_error' };
    } catch {
      if (options.signal?.aborted) return { kind: 'aborted' };
      return timedOut ? { kind: 'client_timeout' } : { kind: 'offline' };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    async weeklySummary(context: CoachContext, options: CallOptions = {}): Promise<CallOutcome> {
      const started = d.now();
      const requestId = d.newRequestId();
      const body = JSON.stringify(
        weeklySummaryRequestSchema.parse({ contractVersion: CONTRACT_VERSION, requestId, context }),
      );

      for (let attempts = 1; ; attempts += 1) {
        const result = await attempt(body, options);
        const retry =
          result.kind === 'upstream_error' &&
          result.retryable &&
          attempts <= MAX_RETRIES &&
          !options.signal?.aborted;
        if (!retry) return { requestId, result, attempts, latencyMs: d.now() - started };
        await d.sleep(backoffMs(attempts, d.random));
      }
    },
  };
}

export type CoachClient = ReturnType<typeof createCoachClient>;
