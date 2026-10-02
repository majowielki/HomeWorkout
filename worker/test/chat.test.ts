import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHAT_LIMITS, type ChatMessage, type ToolCall } from '../../src/ai/contract/chat';
import { CHAT_TOOLS, TOOL_NAMES } from '../../src/ai/contract/chatTools';
import { CONTRACT_VERSION } from '../../src/ai/contract/versions';
import { estimateInputTokens } from '../src/chatRoute';
import { createHandler } from '../src/index';
import {
  ask,
  callStep,
  chatBody,
  facts,
  freshDay,
  mockModel,
  postChat,
  readEvents,
  recordingCtx,
  SECRET,
  sparseFacts,
  streamingModel,
  streamResult,
  testEnv,
  textStep,
} from './helpers';

const handlerWith = (model: MockLanguageModelV4 | null, extra = {}) =>
  createHandler({ model: () => model, now: () => day, ...extra });

// One budget day per test file run: a fixed clock so the counters can be read back.
let day = freshDay();

async function call(
  handler: ExportedHandler<ReturnType<typeof testEnv>>,
  request: Request,
  env = testEnv(),
) {
  const { ctx, settled } = recordingCtx();
  const response = await handler.fetch!(request as never, env, ctx);
  return { response, settled, env };
}

/** Everything a call produced: its status, the events, and the log lines once the call is over. */
async function run(
  model: MockLanguageModelV4 | null,
  body: unknown,
  extra: Record<string, unknown> = {},
) {
  const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  const env = testEnv();
  const { response, settled } = await call(handlerWith(model, extra), postChat(body), env);
  const isStream = response.headers.get('content-type')?.includes('ndjson');
  const events = isStream ? await readEvents(response) : [];
  const json = isStream ? null : response.status === 499 ? null : await response.json();
  await settled();
  const lines = logs.mock.calls
    .map(([line]) => (typeof line === 'string' ? line : ''))
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { status: response.status, headers: response.headers, events, json, lines, env };
}

const spentToday = async (env: ReturnType<typeof testEnv>) =>
  Number((await env.BUDGET.get(`tokens:${day.toISOString().slice(0, 10)}`)) ?? 0);

afterEach(() => {
  vi.restoreAllMocks();
  day = freshDay();
});

describe('a question that needs no tool', () => {
  it('streams the answer as NDJSON, then says why it stopped and what it cost', async () => {
    const model = streamingModel(textStep(['Trzy ', 'sesje ', 'w tygodniu.'], [1200, 14]));
    const result = await run(model, chatBody([ask()]));

    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.events).toEqual([
      { type: 'start', requestId: 'req-chat-0001', promptVersion: 'chat/v1', model: 'mock-coach' },
      { type: 'text', delta: 'Trzy ' },
      { type: 'text', delta: 'sesje ' },
      { type: 'text', delta: 'w tygodniu.' },
      { type: 'finish', reason: 'stop', usage: { inputTokens: 1200, outputTokens: 14 } },
    ]);
  });

  it('sends the model the instructions with the facts, and the conversation as messages', async () => {
    const model = streamingModel(textStep(['ok']));
    await run(model, chatBody([ask('Ile mam sesji?')], { facts: sparseFacts }));

    const sent = model.doStreamCalls[0]!;
    const system = sent.prompt.find((m) => m.role === 'system');
    expect(JSON.stringify(system)).toContain('<session_facts>');
    expect(JSON.stringify(system)).toContain('SPARSE_HISTORY');
    expect(JSON.stringify(sent.prompt.filter((m) => m.role === 'user'))).toContain(
      'Ile mam sesji?',
    );
    expect(sent.temperature).toBe(0.3);
    expect(sent.maxOutputTokens).toBe(900);
  });

  it('keeps Polish letters intact through the stream', async () => {
    const model = streamingModel(textStep(['Żółć, łąka, ', 'ćwiczenia śrubą.']));
    const { events } = await run(model, chatBody([ask()]));
    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(text).toBe('Żółć, łąka, ćwiczenia śrubą.');
  });

  it('does not forward reasoning or step boundaries', async () => {
    const model = streamingModel([
      { type: 'stream-start', warnings: [] },
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', delta: 'thinking about the knee' },
      { type: 'reasoning-end', id: 'r1' },
      ...textStep(['Cześć.']).slice(1),
    ]);
    const { events } = await run(model, chatBody([ask()]));
    expect(JSON.stringify(events)).not.toContain('thinking');
    expect(events.map((e) => e.type)).toEqual(['start', 'text', 'finish']);
  });

  it('reports a reply that was cut off as such', async () => {
    const model = streamingModel([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'Urwane' },
      { type: 'text-end', id: 't' },
      {
        type: 'finish',
        finishReason: { unified: 'length', raw: 'MAX_TOKENS' },
        usage: textStep([])[2]
          ? {
              inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 5, text: 5, reasoning: 0 },
            }
          : undefined,
      },
    ]);
    const { events } = await run(model, chatBody([ask()]));
    expect(events.at(-1)).toMatchObject({ type: 'finish', reason: 'length' });
  });
});

describe('a question that needs tools', () => {
  const lookup = { id: 'c1', name: 'findExercises', input: { query: 'wios' } };

  it('hands the call back, with its id and arguments, and says to run it', async () => {
    const model = streamingModel(callStep([lookup]));
    const { events } = await run(model, chatBody([ask()]));
    expect(events).toEqual([
      expect.objectContaining({ type: 'start' }),
      { type: 'tool_call', call: { id: 'c1', name: 'findExercises', input: { query: 'wios' } } },
      { type: 'finish', reason: 'tool_calls', usage: { inputTokens: 1000, outputTokens: 60 } },
    ]);
  });

  it('declares every tool to the model from the shared definitions, none of them executable', async () => {
    const model = streamingModel(callStep([lookup]));
    await run(model, chatBody([ask()]));
    const declared = model.doStreamCalls[0]!.tools ?? [];
    expect(declared.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    const volume = declared.find((t) => t.name === 'getWeeklyVolume');
    expect(volume).toMatchObject({ description: CHAT_TOOLS.getWeeklyVolume.description });
    expect(JSON.stringify(volume)).toContain('weeksAgo');
    expect(model.doStreamCalls[0]!.toolChoice).toEqual({ type: 'auto' });
  });

  it('gives the model the earlier calls and their results when it is asked again', async () => {
    const call1: ToolCall = { id: 'c1', name: 'findExercises', input: { query: 'wios' } };
    const messages: ChatMessage[] = [
      ask(),
      { role: 'assistant', text: 'Sprawdzam.', toolCalls: [call1] },
      {
        role: 'tool',
        results: [
          {
            callId: 'c1',
            name: 'findExercises',
            output: {
              total: 1,
              exercises: [{ id: 'row', name: 'Wiosłowanie', primaryMuscles: ['back'] }],
            },
          },
        ],
      },
    ];
    const model = streamingModel(textStep(['Znalazłem.']));
    const { events } = await run(model, chatBody(messages));
    expect(events.at(-1)).toMatchObject({ type: 'finish', reason: 'stop' });

    const prompt = JSON.stringify(model.doStreamCalls[0]!.prompt);
    expect(prompt).toContain('"toolCallId":"c1"');
    expect(prompt).toContain('Sprawdzam.');
    expect(prompt).toContain('Wiosłowanie');
  });

  it('forwards at most the allowed number of calls in a round and counts the rest as dropped', async () => {
    const many = Array.from({ length: CHAT_LIMITS.callsPerRound + 2 }, (_, i) => ({
      id: `c${i}`,
      name: 'getBodyTrend',
      input: { days: 30 },
    }));
    const model = streamingModel(callStep(many));
    const { events, lines } = await run(model, chatBody([ask()]));
    expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(CHAT_LIMITS.callsPerRound);
    expect(lines.at(-1)).toMatchObject({
      toolCalls: CHAT_LIMITS.callsPerRound + 2,
      droppedCalls: 2,
    });
  });

  it('forbids tools after the last allowed round, and says so to the provider', async () => {
    const turn: ChatMessage[] = [ask()];
    for (let i = 0; i < CHAT_LIMITS.toolRounds; i += 1) {
      const c: ToolCall = { id: `r${i}`, name: 'getBodyTrend', input: { days: 30 } };
      turn.push(
        { role: 'assistant', text: '', toolCalls: [c] },
        {
          role: 'tool',
          results: [
            { callId: c.id, name: c.name, output: { days: 30, weight: null, waist: null } },
          ],
        },
      );
    }
    const model = streamingModel(textStep(['Tyle mam.']));
    await run(model, chatBody(turn));
    expect(model.doStreamCalls[0]!.toolChoice).toEqual({ type: 'none' });
    // Still declared: earlier calls are in the history.
    expect(model.doStreamCalls[0]!.tools).toHaveLength(TOOL_NAMES.length);
  });

  it('still allows tools one round before that', async () => {
    const turn: ChatMessage[] = [ask()];
    for (let i = 0; i < CHAT_LIMITS.toolRounds - 1; i += 1) {
      const c: ToolCall = { id: `r${i}`, name: 'getBodyTrend', input: { days: 30 } };
      turn.push(
        { role: 'assistant', text: '', toolCalls: [c] },
        {
          role: 'tool',
          results: [
            { callId: c.id, name: c.name, output: { days: 30, weight: null, waist: null } },
          ],
        },
      );
    }
    const model = streamingModel(callStep([lookupCall('last')]));
    await run(model, chatBody(turn));
    expect(model.doStreamCalls[0]!.toolChoice).toEqual({ type: 'auto' });
  });

  it('fails the turn when the model names a tool that does not exist', async () => {
    const model = streamingModel(callStep([{ id: 'x', name: 'deleteEverything', input: {} }]));
    const result = await run(model, chatBody([ask()]));
    // Nothing had been sent yet, so it is a proper error response.
    expect(result.status).toBe(422);
    expect(result.json).toMatchObject({ kind: 'invalid_output', promptVersion: 'chat/v1' });
  });

  it('fails the turn when the arguments do not fit the tool', async () => {
    const model = streamingModel(
      callStep([{ id: 'x', name: 'getWeeklyVolume', input: { weeksAgo: 99 } }]),
    );
    const result = await run(model, chatBody([ask()]));
    expect(result.status).toBe(422);
    expect(result.json).toMatchObject({ kind: 'invalid_output' });
  });
});

function lookupCall(id: string) {
  return { id, name: 'findExercises', input: { query: 'x' } };
}

describe('what is refused before the model is asked', () => {
  const never = () => streamingModel(textStep(['nope']));

  it.each([
    ['no secret', {}],
    ['a wrong secret', { 'x-app-secret': 'nope' }],
  ])('rejects %s', async (_name, headers) => {
    const model = never();
    const { ctx } = recordingCtx();
    const response = await createHandler({ model: () => model }).fetch!(
      postChat(chatBody([ask()]), headers) as never,
      testEnv(),
      ctx,
    );
    expect(response.status).toBe(401);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it('answers 429 with Retry-After from the chat limiter, not the summary one', async () => {
    const model = never();
    const env = testEnv({
      CHAT_LIMITER: { limit: async () => ({ success: false }) } as unknown as RateLimit,
    });
    const { response } = await call(handlerWith(model), postChat(chatBody([ask()])), env);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await response.json()).toEqual({ kind: 'rate_limited' });
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it('is not throttled by the summary limiter', async () => {
    const env = testEnv({
      LIMITER: { limit: async () => ({ success: false }) } as unknown as RateLimit,
    });
    const { response } = await call(handlerWith(never()), postChat(chatBody([ask()])), env);
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  });

  it('answers 409 for another contract version', async () => {
    const result = await run(never(), {
      ...chatBody([ask()]),
      contractVersion: CONTRACT_VERSION + 1,
    });
    expect(result.status).toBe(409);
    expect(result.json).toEqual({
      kind: 'contract_mismatch',
      expected: CONTRACT_VERSION,
      got: CONTRACT_VERSION + 1,
    });
  });

  it('answers 400 for a conversation a model could not continue', async () => {
    const model = never();
    const result = await run(
      model,
      chatBody([ask(), { role: 'assistant', text: 'Odpowiedź.', toolCalls: [] }]),
    );
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ kind: 'bad_request', issues: 1 });
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it('answers 400 for text it cannot read as JSON', async () => {
    const { response } = await call(handlerWith(never()), postChat('{nope'));
    expect(response.status).toBe(400);
  });

  it('answers 413 for a body that is too large', async () => {
    const big = chatBody([ask('x'.repeat(100))]);
    big.messages = Array.from({ length: 1 }, () => ask('y'.repeat(100)));
    const { response } = await call(
      handlerWith(never()),
      postChat(JSON.stringify(big) + ' '.repeat(70_000)),
    );
    expect(response.status).toBe(413);
  });

  it('answers 500 when the Worker has no model', async () => {
    const result = await run(null, chatBody([ask()]));
    expect(result.status).toBe(500);
    expect(result.json).toEqual({ kind: 'misconfigured' });
  });

  it('answers 429 once the day’s budget is gone, without calling the model', async () => {
    const model = never();
    const env = testEnv({ DAILY_TOKEN_BUDGET: '1000' });
    await env.BUDGET.put(`tokens:${day.toISOString().slice(0, 10)}`, '1000');
    const { response } = await call(handlerWith(model), postChat(chatBody([ask()])), env);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ kind: 'budget_exhausted' });
    expect(model.doStreamCalls).toHaveLength(0);
  });
});

describe('the text gate, on this side of the wire too', () => {
  it.each([
    ['an injury', 'Strzyknęło mnie w kolanie przy przysiadzie'],
    ['a complaint nobody located', 'Coś mnie boli od tygodnia'],
    ['a question about diet', 'Ile białka mam jeść po treningu?'],
    ['a question about medication', 'Czy mogę zwiększyć dawkę leku?'],
  ])('never lets %s reach the provider', async (_name, text) => {
    const model = streamingModel(textStep(['nope']));
    const result = await run(model, chatBody([ask(text)]));
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ kind: 'bad_request', issues: 1 });
    expect(model.doStreamCalls).toHaveLength(0);
    expect(result.lines.at(-1)).toMatchObject({ outcome: 'rejected', reason: 'text_gate' });
    expect(JSON.stringify(result.lines)).not.toContain(text);
  });

  it('judges every question in the conversation, not only the last', async () => {
    const earlier: ChatMessage[] = [
      ask('Kłuje mnie w barku'),
      {
        role: 'assistant',
        text: 'Dolegliwości omów z fizjoterapeutą lub lekarzem.',
        toolCalls: [],
      },
      ask('A jak wiosłowanie?'),
    ];
    const model = streamingModel(textStep(['nope']));
    const result = await run(model, chatBody(earlier));
    expect(result.status).toBe(400);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it('lets muscle soreness through: it is what the coach is for', async () => {
    const model = streamingModel(textStep(['Zakwasy to normalne.']));
    const result = await run(model, chatBody([ask('Mam zakwasy w nogach po wczorajszym')]));
    expect(result.status).toBe(200);
    expect(model.doStreamCalls).toHaveLength(1);
  });
});

describe('when the provider fails', () => {
  const failing = (error: unknown) =>
    new MockLanguageModelV4({
      modelId: 'mock-coach',
      doStream: async () => {
        throw error;
      },
    });
  const apiError = (statusCode: number) =>
    new APICallError({ message: 'x', url: 'https://p', requestBodyValues: {}, statusCode });

  it('before anything is sent, answers with a status and the retryable flag', async () => {
    const result = await run(failing(apiError(503)), chatBody([ask()]));
    expect(result.status).toBe(502);
    expect(result.json).toEqual({ kind: 'upstream_error', retryable: true });
    expect(result.lines.at(-1)).toMatchObject({ outcome: 'upstream_error', status: 502 });
  });

  it('marks a refusal that retrying cannot fix as not retryable', async () => {
    const result = await run(failing(apiError(400)), chatBody([ask()]));
    expect(result.json).toEqual({ kind: 'upstream_error', retryable: false });
  });

  it('does not log what the provider said', async () => {
    const error = new APICallError({
      message: 'the request contained: Wiosłowanie sekretne',
      url: 'https://p',
      requestBodyValues: { secret: 'Wiosłowanie sekretne' },
      statusCode: 500,
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await run(failing(error), chatBody([ask('Wiosłowanie sekretne')]));
    expect(JSON.stringify(result.lines)).not.toContain('sekretne');
    expect(errors).not.toHaveBeenCalled();
  });

  it('midway through the answer, says so in the stream, after the text already sent', async () => {
    const model = new MockLanguageModelV4({
      modelId: 'mock-coach',
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't' });
            controller.enqueue({ type: 'text-delta', id: 't', delta: 'Zaczynam' });
            controller.enqueue({ type: 'error', error: apiError(503) });
            controller.close();
          },
        }),
      }),
    });
    const result = await run(model, chatBody([ask()]));
    expect(result.status).toBe(200);
    expect(result.events.map((e) => e.type)).toEqual(['start', 'text', 'error']);
    expect(result.events.at(-1)).toEqual({
      type: 'error',
      error: { kind: 'upstream_error', retryable: true },
    });
    expect(result.lines.at(-1)).toMatchObject({ outcome: 'upstream_error', status: 200 });
  });

  it('turns a stream that stops without saying why into a finish that is not "stop"', async () => {
    const model = new MockLanguageModelV4({
      modelId: 'mock-coach',
      doStream: streamResult([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'Urwane' },
      ]),
    });
    const result = await run(model, chatBody([ask()]));
    // The SDK closes such a stream itself; the phone must not read "other" as a complete answer.
    expect(result.events.at(-1)).toMatchObject({ type: 'finish', reason: 'other' });
  });

  it('reports a stream that produced nothing as a failure rather than an empty answer', async () => {
    const model = new MockLanguageModelV4({ modelId: 'mock-coach', doStream: streamResult([]) });
    const result = await run(model, chatBody([ask()]));
    expect(result.status).toBe(502);
    expect(result.json).toMatchObject({ kind: 'upstream_error' });
  });

  it('gives up on a step that takes longer than allowed, with its own status', async () => {
    const hanging = new MockLanguageModelV4({
      modelId: 'mock-coach',
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream({
          start(controller) {
            abortSignal?.addEventListener('abort', () => controller.error(abortSignal.reason));
          },
        }),
      }),
    });
    const result = await run(hanging, chatBody([ask()]), { chatTimeoutMs: 30 });
    expect(result.status).toBe(504);
    expect(result.json).toEqual({ kind: 'timeout' });
    expect(result.lines.at(-1)).toMatchObject({ outcome: 'timeout' });
  });

  it('times out in the stream when it had already begun', async () => {
    const slow = new MockLanguageModelV4({
      modelId: 'mock-coach',
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't' });
            controller.enqueue({ type: 'text-delta', id: 't', delta: 'Zaczęte' });
            abortSignal?.addEventListener('abort', () => controller.error(abortSignal.reason));
          },
        }),
      }),
    });
    const result = await run(slow, chatBody([ask()]), { chatTimeoutMs: 30 });
    expect(result.status).toBe(200);
    expect(result.events.at(-1)).toEqual({ type: 'error', error: { kind: 'timeout' } });
  });
});

describe('cancelling', () => {
  /** A model that sends one piece and then waits, noting whether the provider call was aborted. */
  function waitingModel() {
    const seen = { aborted: false };
    const model = new MockLanguageModelV4({
      modelId: 'mock-coach',
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't' });
            controller.enqueue({ type: 'text-delta', id: 't', delta: 'Zaczynam odpowiedź' });
            abortSignal?.addEventListener('abort', () => {
              seen.aborted = true;
              controller.error(abortSignal.reason);
            });
          },
        }),
      }),
    });
    return { model, seen };
  }

  it('aborts the call to the provider when the reader goes away, and logs it as aborted', async () => {
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { model, seen } = waitingModel();
    const env = testEnv();
    const { ctx, settled } = recordingCtx();
    const response = await handlerWith(model).fetch!(
      postChat(chatBody([ask()])) as never,
      env,
      ctx,
    );

    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await reader.cancel();
    await settled();

    expect(seen.aborted).toBe(true);
    expect(model.doStreamCalls[0]!.abortSignal?.aborted).toBe(true);
    const logged = logs.mock.calls.map(([l]) => JSON.parse(l as string) as Record<string, unknown>);
    expect(logged.filter((l) => l.event === 'chat')).toHaveLength(1);
    expect(logged.at(-1)).toMatchObject({ event: 'chat', outcome: 'aborted' });
  });

  it('still charges the call, by estimate, since the provider never said what it cost', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { model } = waitingModel();
    const env = testEnv();
    const body = JSON.stringify(chatBody([ask()]));
    const { ctx, settled } = recordingCtx();
    const response = await handlerWith(model).fetch!(postChat(body) as never, env, ctx);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await settled();

    expect(await spentToday(env)).toBe(estimateInputTokens(new TextEncoder().encode(body).length));
  });

  it('logs a connection the caller dropped before any output as aborted, without a response', async () => {
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    const controller = new AbortController();
    const model = new MockLanguageModelV4({
      modelId: 'mock-coach',
      doStream: async ({ abortSignal }) => {
        controller.abort();
        abortSignal?.throwIfAborted();
        throw new Error('not reached');
      },
    });
    const { response } = await call(
      handlerWith(model),
      postChat(chatBody([ask()]), undefined, controller.signal),
    );
    expect(response.status).toBe(499);
    const logged = logs.mock.calls.map(([l]) => JSON.parse(l as string) as Record<string, unknown>);
    expect(logged.at(-1)).toMatchObject({ event: 'chat', outcome: 'aborted' });
  });
});

describe('what is charged and what is logged', () => {
  it('charges what the provider reports, once, after the stream', async () => {
    const env = testEnv();
    const model = streamingModel(textStep(['ok'], [1500, 50]));
    const { ctx, settled } = recordingCtx();
    const response = await handlerWith(model).fetch!(
      postChat(chatBody([ask()])) as never,
      env,
      ctx,
    );
    await response.arrayBuffer();
    await settled();
    expect(await spentToday(env)).toBe(1550);
  });

  it('writes one line per call, with counts and no content', async () => {
    const question = 'Jak mi idzie z unikalnymwiosłowaniem?';
    const reply = 'Unikalna odpowiedź o wiosłowaniu.';
    const model = streamingModel(textStep([reply], [900, 20]));
    const result = await run(model, chatBody([ask(question)]));

    const chatLines = result.lines.filter((l) => l.event === 'chat');
    expect(chatLines).toHaveLength(1);
    expect(chatLines[0]).toMatchObject({
      event: 'chat',
      requestId: 'req-chat-0001',
      promptVersion: 'chat/v1',
      model: 'mock-coach',
      tokensIn: 900,
      tokensOut: 20,
      outcome: 'ok',
      status: 200,
      toolRound: 0,
      toolCalls: 0,
      finishReason: 'stop',
      guardViolations: 0,
      replyChars: reply.length,
    });
    const text = JSON.stringify(result.lines);
    expect(text).not.toContain('unikalnym');
    expect(text).not.toContain('Unikalna');
  });

  it('counts the rules a reply broke, but still sends it: the phone is the one that withdraws it', async () => {
    const model = streamingModel(textStep(['Zjedz więcej białka po treningu.']));
    const result = await run(model, chatBody([ask('Jak idzie wiosłowanie?')]));
    expect(result.events.some((e) => e.type === 'text')).toBe(true);
    expect(result.lines.at(-1)).toMatchObject({ outcome: 'ok', guardViolations: 1 });
  });

  it('counts trend words as a violation only while the history is thin', async () => {
    const trendy = () => streamingModel(textStep(['Widać wyraźny trend wzrostowy.']));
    const sparse = await run(trendy(), chatBody([ask()], { facts: sparseFacts }));
    expect(sparse.lines.at(-1)).toMatchObject({ guardViolations: 1 });
    const rich = await run(trendy(), chatBody([ask()]));
    expect(rich.lines.at(-1)).toMatchObject({ guardViolations: 0 });
  });

  it('records the tool round the question was on', async () => {
    const c: ToolCall = { id: 'c1', name: 'getBodyTrend', input: { days: 30 } };
    const messages: ChatMessage[] = [
      ask(),
      { role: 'assistant', text: '', toolCalls: [c] },
      {
        role: 'tool',
        results: [
          { callId: 'c1', name: 'getBodyTrend', output: { days: 30, weight: null, waist: null } },
        ],
      },
    ];
    const result = await run(streamingModel(textStep(['ok'])), chatBody(messages));
    expect(result.lines.at(-1)).toMatchObject({ toolRound: 1 });
  });

  it('estimates the input tokens as a third of the bytes, rounded up', () => {
    expect(estimateInputTokens(3)).toBe(1);
    expect(estimateInputTokens(4)).toBe(2);
    expect(estimateInputTokens(0)).toBe(0);
  });
});

describe('the summary endpoint next to it', () => {
  it('still refuses a chat body, and the chat still refuses a summary body', async () => {
    const { ctx } = recordingCtx();
    const handler = createHandler({ model: () => mockModel() });
    const wrong = new Request('https://coach.test/v1/weekly-summary', {
      method: 'POST',
      headers: { 'x-app-secret': SECRET },
      body: JSON.stringify(chatBody([ask()])),
    });
    expect((await handler.fetch!(wrong as never, testEnv(), ctx)).status).toBe(400);
  });
});

describe('how long the model thinks, and what is logged about it', () => {
  const sentOptions = (model: MockLanguageModelV4) => model.doStreamCalls[0]!.providerOptions;

  it('tells the provider the configured thinking level', async () => {
    const model = streamingModel(textStep(['ok']));
    const env = testEnv({ THINKING_LEVEL: 'low' });
    const { response, settled } = await call(handlerWith(model), postChat(chatBody([ask()])), env);
    await response.arrayBuffer();
    await settled();
    expect(sentOptions(model)).toEqual({ google: { thinkingConfig: { thinkingLevel: 'low' } } });
  });

  it('sends no setting when none is configured, or the level is unknown', async () => {
    for (const level of [undefined, 'extreme']) {
      const model = streamingModel(textStep(['ok']));
      const env = testEnv({ THINKING_LEVEL: level });
      const { response, settled } = await call(
        handlerWith(model),
        postChat(chatBody([ask()])),
        env,
      );
      await response.arrayBuffer();
      await settled();
      expect(sentOptions(model)).toBeUndefined();
    }
  });

  it('logs how many of the output tokens were thinking, and how long until the first event', async () => {
    const thinking = [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'Krótko.' },
      { type: 'text-end', id: 't' },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'STOP' },
        usage: {
          inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 300, text: 40, reasoning: 260 },
        },
      },
    ];
    const result = await run(streamingModel(thinking), chatBody([ask()]));
    expect(result.lines.at(-1)).toMatchObject({
      tokensOut: 300,
      reasoningTokens: 260,
      firstEventMs: expect.any(Number),
    });
  });

  it('logs the status a provider refused with, a number and never its message', async () => {
    const refusing = (statusCode: number, message: string) =>
      new MockLanguageModelV4({
        modelId: 'mock-coach',
        doStream: async () => {
          throw new APICallError({
            message,
            url: 'https://p',
            requestBodyValues: {},
            statusCode,
          });
        },
      });

    for (const [status, message] of [
      [400, 'API key not valid. Please pass a valid API key.'],
      [429, 'Resource has been exhausted'],
      [503, 'The model is overloaded'],
    ] as const) {
      const result = await run(refusing(status, message), chatBody([ask()]));
      expect(result.lines.at(-1)).toMatchObject({
        outcome: 'upstream_error',
        upstreamStatus: status,
      });
      expect(JSON.stringify(result.lines)).not.toContain(message);
    }
  });

  it('has no status to log for a failure that is not the provider refusing', async () => {
    const model = new MockLanguageModelV4({
      modelId: 'mock-coach',
      doStream: async () => {
        throw new Error('socket closed');
      },
    });
    const result = await run(model, chatBody([ask()]));
    expect(result.lines.at(-1)).toMatchObject({ outcome: 'upstream_error' });
    expect(result.lines.at(-1)).not.toHaveProperty('upstreamStatus');
  });
});
