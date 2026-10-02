import { apiErrorSchema } from '../contract/api';
import {
  type ChatEvent,
  chatEventSchema,
  type ChatRequest,
  chatRequestSchema,
} from '../contract/chat';
import { backoffMs, type ClientDeps, type ClientFailure, MAX_RETRIES } from './coachClient';
import type { CoachConfig } from './config';
import { createLineSplitter, LineTooLongError } from './ndjson';

/** How a streamed step ended. The text and the calls it carried already went to `onEvent`. */
export type StreamEnd = { kind: 'complete' } | { kind: 'failed'; failure: ClientFailure };

export interface ChatStreamOptions {
  signal?: AbortSignal;
  /** Called for every event, in order, as it arrives. */
  onEvent: (event: ChatEvent) => void;
  /** Longest silence tolerated between two chunks, once the answer has begun or while waiting for it. */
  idleTimeoutMs?: number;
}

/** The Worker's own limit per step is 45 s; the client waits for a sign of life, not for the whole answer. */
export const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
/** A line is one event; nothing legitimate comes near this. */
export const MAX_LINE_BYTES = 64 * 1024;

/**
 * Streaming client for `POST /v1/chat`: sends one request, reads the
 * newline-delimited events as they arrive, and says how it ended.
 *
 * Failure comes in two shapes, as the Worker sends it. Before the first
 * byte it is an ordinary JSON error with a status; after, it is an `error`
 * event inside the stream. Both end as the same `failed` result, so the
 * caller has one case to handle. Only a failure the Worker marked as worth
 * repeating, and only while nothing visible has arrived, is retried.
 *
 * Cancelling closes the connection, which is what tells the Worker to stop
 * the provider.
 */
export function createChatStreamer(
  config: CoachConfig,
  deps: Partial<Omit<ClientDeps, 'newRequestId'>> = {},
): { stream(request: ChatRequest, options: ChatStreamOptions): Promise<StreamEnd> } {
  const d: Omit<ClientDeps, 'newRequestId'> = {
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
    now: Date.now,
    ...deps,
  };

  /** One attempt. `visible` says whether text or a tool call reached the caller. */
  async function attempt(
    body: string,
    options: ChatStreamOptions,
  ): Promise<{ end: StreamEnd; visible: boolean }> {
    const failed = (failure: ClientFailure, visible = false) => ({
      end: { kind: 'failed' as const, failure },
      visible,
    });
    // Already cancelled: do not even open a connection.
    if (options.signal?.aborted) return failed({ kind: 'aborted' });

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);
    let idle = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        idle = true;
        controller.abort();
      }, options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);
    };

    let visible = false;
    try {
      arm();
      const response = await d.fetch(`${config.baseUrl}/v1/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
          'x-app-secret': config.secret,
        },
        body,
        signal: controller.signal,
      });

      if (!response.headers.get('content-type')?.includes('ndjson')) {
        const error = apiErrorSchema.safeParse(await response.json().catch(() => null));
        return failed(error.success ? error.data : { kind: 'protocol_error' });
      }
      const reader = response.body?.getReader();
      if (!reader) return failed({ kind: 'protocol_error' });

      const lines = createLineSplitter(MAX_LINE_BYTES);
      for (;;) {
        const { done, value } = await reader.read();
        arm();
        if (done) break;

        for (const line of lines.push(value)) {
          let event: ChatEvent;
          try {
            const parsed = chatEventSchema.safeParse(JSON.parse(line));
            if (!parsed.success) return failed({ kind: 'protocol_error' }, visible);
            event = parsed.data;
          } catch {
            return failed({ kind: 'protocol_error' }, visible);
          }
          if (event.type === 'text' || event.type === 'tool_call') visible = true;
          options.onEvent(event);
          if (event.type === 'error') return failed(event.error, visible);
          if (event.type === 'finish') return { end: { kind: 'complete' }, visible };
        }
      }
      // The connection closed cleanly but the answer never said it was finished: it was cut.
      return failed({ kind: 'offline' }, visible);
    } catch (error) {
      if (options.signal?.aborted) return failed({ kind: 'aborted' }, visible);
      if (error instanceof LineTooLongError) return failed({ kind: 'protocol_error' }, visible);
      return failed({ kind: idle ? 'client_timeout' : 'offline' }, visible);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    async stream(request, options) {
      const body = JSON.stringify(chatRequestSchema.parse(request));
      for (let attempts = 1; ; attempts += 1) {
        const { end, visible } = await attempt(body, options);
        const retry =
          end.kind === 'failed' &&
          end.failure.kind === 'upstream_error' &&
          end.failure.retryable &&
          !visible &&
          attempts <= MAX_RETRIES &&
          !options.signal?.aborted;
        if (!retry) return end;
        await d.sleep(backoffMs(attempts, d.random));
      }
    },
  };
}

export type ChatStreamer = ReturnType<typeof createChatStreamer>;
