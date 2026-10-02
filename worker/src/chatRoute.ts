import { APICallError } from 'ai';

import { type ChatEvent, chatRequestSchema, toolRoundsUsed } from '../../src/ai/contract/chat';
import type { ApiError } from '../../src/ai/contract/api';
import { CONTRACT_VERSION } from '../../src/ai/contract/versions';
import { CHAT_PROMPT_VERSION } from '../../src/ai/prompts/chat/v1';
import { detectTextSignal } from '../../src/domain/coach/medicalSignal';
import { detectOutOfScope } from '../../src/domain/coach/topicGuard';
import { InvalidToolCallError, newStats, streamChatStep } from './chat';
import { providerOptionsFromEnv } from './model';
import type { Env } from './env';
import { admit, type Deps, json, STATUS, type Tracked } from './http';
import { estimateCostUsd, logRecord, type Outcome } from './log';
import { modelIdOf, type Tally } from './weeklySummary';

const encoder = new TextEncoder();
const line = (event: ChatEvent) => encoder.encode(`${JSON.stringify(event)}\n`);

/**
 * Input tokens, guessed from the size of the request, for a call that ended
 * before the provider said what it cost. Three bytes a token overstates it
 * a little, which is the safe side of a fence: a cancelled call must not be
 * free, or cancelling would be a way around the daily budget.
 */
export const estimateInputTokens = (bodyBytes: number) => Math.ceil(bodyBytes / 3);

const outcomeOf = (error: ApiError): Outcome =>
  error.kind === 'invalid_output' || error.kind === 'timeout' ? error.kind : 'upstream_error';

/**
 * `POST /v1/chat`: one model step of a conversation, streamed.
 *
 * The Worker holds no conversation. The phone sends all of it with each
 * request and the Worker answers one step: text, or a request to run tools
 * (which the phone runs, then asks again). Called after the secret has
 * been checked.
 *
 * A failure before the first byte is an ordinary error response with a
 * status code, exactly like the summary. After that the status is already
 * 200, so a failure becomes an `error` event, and the phone treats the
 * text it already has as unfinished.
 *
 * Cancelling (the person leaves, or presses stop) closes the connection;
 * that reaches the provider as an abort, and the call is logged as
 * `aborted` with the tokens it is estimated to have cost.
 */
export async function handleChat(
  request: Request,
  env: Env,
  deps: Deps,
  ctx: ExecutionContext,
  started: number,
): Promise<Response> {
  const track: Tracked = { requestId: null, modelId: null };
  const tally: Tally = { inputTokens: 0, outputTokens: 0 };
  const stats = newStats();
  let promptVersion: string | null = null;
  let toolRound = 0;
  let reason: 'text_gate' | undefined;
  let concluded = false;
  let upstreamStatus: number | undefined;
  let firstEventMs: number | undefined;

  const log = (outcome: Outcome, status: number) =>
    logRecord({
      event: 'chat',
      requestId: track.requestId,
      contractVersion: CONTRACT_VERSION,
      promptVersion,
      provider: env.PROVIDER,
      model: track.modelId,
      tokensIn: tally.inputTokens,
      tokensOut: tally.outputTokens,
      latencyMs: Date.now() - started,
      attempts: 1,
      outcome,
      status,
      estimatedCostUsd: estimateCostUsd(tally.inputTokens, tally.outputTokens, env),
      toolRound,
      toolCalls: stats.toolCalls,
      droppedCalls: stats.droppedCalls,
      replyChars: stats.replyChars,
      finishReason: stats.finishReason,
      rawFinishReason: stats.rawFinishReason,
      guardViolations: stats.guardViolations,
      reasoningTokens: stats.reasoningTokens,
      firstEventMs,
      upstreamStatus,
      reason,
    });

  const reject = (error: ApiError, headers?: Record<string, string>) => {
    log('rejected', STATUS[error.kind]);
    return json(error, STATUS[error.kind], headers);
  };

  const admission = await admit({
    request,
    env,
    deps,
    limiter: env.CHAT_LIMITER,
    schema: chatRequestSchema,
    track,
    modelIdOf,
    reject,
  });
  if (!admission.ok) return admission.response;
  const { data, model, maxOutputTokens, budget, bodyBytes } = admission.admitted;
  toolRound = toolRoundsUsed(data.messages);

  // The phone has already judged each message before sending it. This is the same judgement
  // again, on this side of the wire: a text that reads as a complaint, or as a question about
  // diet or medication, never reaches the provider, whoever the caller is (I3, I4).
  const gated = data.messages.filter(
    (m) =>
      m.role === 'user' &&
      (detectTextSignal(m.text) === 'medical' || detectOutOfScope(m.text) !== null),
  ).length;
  if (gated > 0) {
    reason = 'text_gate';
    return reject({ kind: 'bad_request', issues: gated });
  }

  // --- the call --------------------------------------------------------------
  const cancel = new AbortController();
  const timeout = AbortSignal.timeout(deps.chatTimeoutMs);
  const signal = AbortSignal.any([request.signal, timeout, cancel.signal]);
  const iterator = streamChatStep(model, data, {
    abortSignal: signal,
    maxOutputTokens,
    tally,
    stats,
    providerOptions: providerOptionsFromEnv(env),
  })[Symbol.asyncIterator]();

  /** Logs and charges exactly once, however the stream ends. */
  async function conclude(outcome: Outcome, status = 200): Promise<void> {
    if (concluded) return;
    concluded = true;
    // A call that ended before the provider reported usage is not free.
    if (tally.inputTokens === 0 && tally.outputTokens === 0 && outcome !== 'rejected') {
      tally.inputTokens = estimateInputTokens(bodyBytes);
    }
    log(outcome, status);
    await budget.spend(tally.inputTokens + tally.outputTokens);
  }

  const wasCancelled = () => request.signal.aborted || cancel.signal.aborted;

  function failureOf(error: unknown): ApiError | 'aborted' {
    if (wasCancelled()) return 'aborted';
    if (APICallError.isInstance(error)) upstreamStatus = error.statusCode;
    if (error instanceof InvalidToolCallError) {
      return {
        kind: 'invalid_output',
        requestId: data.requestId,
        promptVersion: CHAT_PROMPT_VERSION,
        attempts: 1,
        usage: { inputTokens: tally.inputTokens, outputTokens: tally.outputTokens },
      };
    }
    if (timeout.aborted) return { kind: 'timeout' };
    return {
      kind: 'upstream_error',
      retryable: APICallError.isInstance(error) && error.isRetryable,
    };
  }

  /** The call failed before a single byte went out, so the answer can still carry a proper status. */
  async function refuseEarly(failure: ApiError | 'aborted'): Promise<Response> {
    promptVersion = CHAT_PROMPT_VERSION;
    if (failure === 'aborted') {
      await conclude('aborted', 499);
      return new Response(null, { status: 499 });
    }
    const response = json(failure, STATUS[failure.kind]);
    await conclude(outcomeOf(failure), response.status);
    return response;
  }

  // Wait for the first event the provider produces (the one after our own `start`). The SDK
  // reports a cancelled or timed-out call as an ended stream rather than a throw, so a stream
  // that ends before it has said anything is a failure too, not an empty answer.
  const head: ChatEvent[] = [];
  try {
    for (let i = 0; i < 2; i += 1) {
      const next = await iterator.next();
      if (next.done) break;
      head.push(next.value);
    }
  } catch (error) {
    return refuseEarly(failureOf(error));
  }
  if (!head.some((event) => event.type !== 'start')) {
    return refuseEarly(failureOf(new Error('the stream ended before it began')));
  }
  promptVersion = CHAT_PROMPT_VERSION;
  firstEventMs = Date.now() - started;

  let sawFinish = false;
  const emit = (controller: ReadableStreamDefaultController<Uint8Array>, event: ChatEvent) => {
    if (event.type === 'finish') sawFinish = true;
    controller.enqueue(line(event));
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const queued = head.shift();
        const next = queued ? { done: false as const, value: queued } : await iterator.next();

        if (!next.done) {
          emit(controller, next.value);
          return;
        }
        if (!sawFinish) {
          // The provider's stream ended without saying why. Whoever is listening must not take
          // the text so far for a complete answer.
          const failure = failureOf(new Error('stream ended without a finish'));
          if (failure !== 'aborted') {
            emit(controller, { type: 'error', error: failure });
            await conclude(outcomeOf(failure));
          } else {
            await conclude('aborted');
          }
        } else {
          await conclude('ok');
        }
        controller.close();
      } catch (error) {
        const failure = failureOf(error);
        if (failure === 'aborted') {
          await conclude('aborted');
        } else {
          emit(controller, { type: 'error', error: failure });
          await conclude(outcomeOf(failure));
        }
        controller.close();
      }
    },
    cancel() {
      // The person left or pressed stop. Tell the provider, and still log and charge for the
      // call after the response is gone.
      cancel.abort();
      ctx.waitUntil(conclude('aborted'));
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
