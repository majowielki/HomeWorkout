import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONTRACT_VERSION } from '../../src/ai/contract/versions';
import {
  type WeeklySummaryResponse,
  weeklySummaryResponseSchema,
} from '../../src/ai/contract/weeklySummary';
import { createHandler, MAX_BODY_BYTES } from '../src/index';
import {
  answer,
  context,
  ctx,
  freshDay,
  GOOD,
  mockModel,
  post,
  requestBody,
  SECRET,
  sparseContext,
  testEnv,
} from './helpers';

async function call(
  handler: ExportedHandler<ReturnType<typeof testEnv>>,
  request: Request,
  env = testEnv(),
) {
  const response = await handler.fetch!(request as never, env, ctx);
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    text,
    body: text ? JSON.parse(text) : null,
  };
}

const handlerWith = (model: MockLanguageModelV4 | null, extra = {}) =>
  createHandler({ model: () => model, now: freshDay, ...extra });

afterEach(() => vi.restoreAllMocks());

describe('routing and authentication', () => {
  it.each(['doms', 'short_rest', 'technique', 'pain'] as const)(
    'accepts contract 6 and carries %s into the current summary prompt',
    async (shortfall) => {
      const model = mockModel(answer(GOOD));
      const withSet = {
        ...context,
        sessionCount: 1,
        sessions: [
          {
            date: '2026-10-01',
            template: 'FBW',
            durationMin: 30,
            sessionRpe: 7,
            workingSets: 1,
            exercises: [
              {
                exerciseId: 'row',
                name: 'Wiosłowanie',
                sets: [
                  {
                    reps: 8,
                    timeSec: null,
                    rir: 2,
                    shortfall,
                    load: { kind: 'bodyweight' as const },
                  },
                ],
              },
            ],
          },
        ],
      };
      const result = await call(
        handlerWith(model),
        post(requestBody(withSet), { 'x-app-secret': SECRET }),
      );
      expect(result.status).toBe(200);
      expect(result.body.promptVersion).toBe('weekly-summary/v3');
      const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
      expect(prompt).toContain('reported_shortfall');
      expect(prompt).toContain(shortfall);
    },
  );
  it('answers 404 to anything but POST /v1/weekly-summary', async () => {
    const handler = handlerWith(mockModel(answer(GOOD)));
    const get = new Request('https://coach.test/v1/weekly-summary', { method: 'GET' });
    expect((await call(handler, get)).status).toBe(404);
    const other = new Request('https://coach.test/other', { method: 'POST' });
    expect((await call(handler, other)).body).toEqual({ kind: 'not_found' });
  });

  it.each([
    ['no secret', {}],
    ['a wrong secret', { 'x-app-secret': 'nope' }],
    ['a secret that is a prefix of the right one', { 'x-app-secret': SECRET.slice(0, -1) }],
  ])('rejects %s', async (_name, headers) => {
    const model = mockModel(answer(GOOD));
    const result = await call(handlerWith(model), post(requestBody(), headers));
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ kind: 'unauthorized' });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('refuses everyone when no secret is configured', async () => {
    const env = testEnv({ APP_SECRET: undefined });
    const result = await call(handlerWith(mockModel(answer(GOOD))), post(requestBody()), env);
    expect(result.status).toBe(401);
  });
});

describe('rate limit', () => {
  it('answers 429 with Retry-After and never reaches the model', async () => {
    const model = mockModel(answer(GOOD));
    const env = testEnv({
      LIMITER: { limit: async () => ({ success: false }) } as unknown as RateLimit,
    });
    const result = await call(handlerWith(model), post(requestBody()), env);
    expect(result.status).toBe(429);
    expect(result.headers.get('retry-after')).toBe('60');
    expect(result.body).toEqual({ kind: 'rate_limited' });
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe('the request', () => {
  it('refuses a body whose declared length is far too large', async () => {
    const request = post(requestBody(), {
      'x-app-secret': SECRET,
      'content-length': String(MAX_BODY_BYTES + 1),
    });
    const result = await call(handlerWith(mockModel(answer(GOOD))), request);
    expect(result.status).toBe(413);
  });

  it('refuses a body that is too large whatever it declares', async () => {
    const huge = JSON.stringify({ padding: 'x'.repeat(MAX_BODY_BYTES) });
    const result = await call(handlerWith(mockModel(answer(GOOD))), post(huge));
    expect(result.body).toEqual({ kind: 'payload_too_large' });
  });

  it('answers 400 to something that is not JSON', async () => {
    const result = await call(handlerWith(mockModel(answer(GOOD))), post('{oops'));
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ kind: 'bad_request', issues: 1 });
  });

  it('answers 409 with both versions when the contract differs', async () => {
    const model = mockModel(answer(GOOD));
    const result = await call(
      handlerWith(model),
      post({ ...requestBody(), contractVersion: CONTRACT_VERSION + 1 }),
    );
    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      kind: 'contract_mismatch',
      expected: CONTRACT_VERSION,
      got: CONTRACT_VERSION + 1,
    });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('answers 409 with "got: null" when the request names no version', async () => {
    const { contractVersion: _dropped, ...withoutVersion } = requestBody();
    const result = await call(handlerWith(mockModel(answer(GOOD))), post(withoutVersion));
    expect(result.body).toEqual({
      kind: 'contract_mismatch',
      expected: CONTRACT_VERSION,
      got: null,
    });
  });

  it('answers 409 to a body that is not even an object', async () => {
    const result = await call(handlerWith(mockModel(answer(GOOD))), post('[1,2]'));
    expect(result.body).toMatchObject({ kind: 'contract_mismatch', got: null });
  });

  it('answers 400 with a count, not the issues, when a field is wrong', async () => {
    const bad = { ...requestBody(), context: { ...context, windowDays: -1 } };
    const result = await call(handlerWith(mockModel(answer(GOOD))), post(bad));
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ kind: 'bad_request', issues: expect.any(Number) });
    expect(result.text).not.toContain('windowDays');
  });

  it('rejects a field the contract does not list', async () => {
    const result = await call(
      handlerWith(mockModel(answer(GOOD))),
      post({ ...requestBody(), userId: 'someone' }),
    );
    expect(result.status).toBe(400);
  });
});

describe('configuration', () => {
  it('answers 500 when no model can be built', async () => {
    const result = await call(handlerWith(null), post(requestBody()));
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ kind: 'misconfigured' });
  });

  it.each([
    ['DAILY_TOKEN_BUDGET', 'plenty'],
    ['DAILY_TOKEN_BUDGET', '0'],
    ['MAX_OUTPUT_TOKENS', ''],
  ])('answers 500 when %s is %j', async (key, value) => {
    const model = mockModel(answer(GOOD));
    const result = await call(handlerWith(model), post(requestBody()), testEnv({ [key]: value }));
    expect(result.body).toEqual({ kind: 'misconfigured' });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('is misconfigured, not crashing, when the deployed defaults have no provider key', async () => {
    const response = await exports.default.fetch(post(requestBody()));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ kind: 'misconfigured' });
  });
});

describe('a good answer', () => {
  it('returns the summary with the metadata the app stores', async () => {
    const model = mockModel(answer(GOOD, [1200, 150]));
    const result = await call(handlerWith(model), post(requestBody()));

    expect(result.status).toBe(200);
    expect(weeklySummaryResponseSchema.safeParse(result.body).success).toBe(true);
    expect(result.body).toEqual({
      kind: 'ok',
      requestId: 'req-0001-abcdef',
      promptVersion: 'weekly-summary/v3',
      model: 'mock-coach',
      usage: { inputTokens: 1200, outputTokens: 150 },
      validationOutcome: 'ok',
      summary: GOOD,
    });
    expect(result.headers.get('cache-control')).toBe('no-store');
  });

  it('gives the model the rules as instructions and the data as the prompt', async () => {
    const model = mockModel(answer(GOOD));
    await call(handlerWith(model), post(requestBody()));

    const call0 = model.doGenerateCalls[0]!;
    const roles = call0.prompt.map((m) => m.role);
    expect(roles).toEqual(['system', 'user']);
    expect(JSON.stringify(call0.prompt[0])).toContain('medical_guardrail');
    expect(JSON.stringify(call0.prompt[1])).toContain('coach_context');
    expect(call0.temperature).toBe(0.2);
    expect(call0.maxOutputTokens).toBe(900);
  });

  it('asks for a schema that has no loads, no constants and no unions', async () => {
    const model = mockModel(answer(GOOD));
    await call(handlerWith(model), post(requestBody()));
    const format = model.doGenerateCalls[0]!.responseFormat as { type: string; schema?: unknown };
    expect(format.type).toBe('json');
    const schema = JSON.stringify(format.schema);
    expect(schema).not.toContain('"const"');
    expect(schema).not.toContain('"anyOf"');
    expect(schema).not.toMatch(/kg|load|weight/i);
  });

  it('passes the abort signal on to the model', async () => {
    const model = mockModel(answer(GOOD));
    await call(handlerWith(model), post(requestBody()));
    expect(model.doGenerateCalls[0]!.abortSignal).toBeInstanceOf(AbortSignal);
  });
});

describe('a bad answer', () => {
  it('repairs a broken JSON once, telling the model why', async () => {
    const model = mockModel(answer('{"headline":'), answer(GOOD));
    const result = await call(handlerWith(model), post(requestBody()));

    expect(result.body).toMatchObject({ kind: 'ok', validationOutcome: 'ok_after_repair' });
    expect(result.body.usage).toEqual({ inputTokens: 2000, outputTokens: 200 });
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain('previous_error');
  });

  it('repairs a summary that breaks a rule, naming the rule but not repeating the text', async () => {
    const trendy = { ...GOOD, headline: 'Wyraźny trend wzrostowy.' };
    const model = mockModel(answer(trendy), answer(GOOD));
    const result = await call(handlerWith(model), post(requestBody(sparseContext)));

    expect(result.body).toMatchObject({ kind: 'ok', validationOutcome: 'ok_after_repair' });
    const second = JSON.stringify(model.doGenerateCalls[1]!.prompt);
    expect(second).toContain('not allowed while the history is sparse');
    expect(second).not.toContain('Wyraźny');
  });

  it('refuses a flag the context never carried', async () => {
    const invented = { ...GOOD, flags: [{ code: 'LAYOFF_LONG', comment: 'Długa przerwa.' }] };
    const model = mockModel(answer(invented), answer(invented));
    const result = await call(handlerWith(model), post(requestBody()));
    expect(result.status).toBe(422);
  });

  it('refuses diet and advice about a complaint', async () => {
    const diet = { ...GOOD, highlights: ['Zjedz więcej białka po treningu.'] };
    const advice = { ...GOOD, highlights: ['Zrób rozciąganie i okład.'] };
    expect(
      (await call(handlerWith(mockModel(answer(diet), answer(diet))), post(requestBody()))).status,
    ).toBe(422);
    expect(
      (await call(handlerWith(mockModel(answer(advice), answer(advice))), post(requestBody())))
        .status,
    ).toBe(422);
  });

  it('gives up after two bad answers, returning nothing that could mislead', async () => {
    const model = mockModel(answer('not json'), answer({ headline: 1 }));
    const result = await call(handlerWith(model), post(requestBody()));

    expect(result.status).toBe(422);
    expect(result.body).toEqual({
      kind: 'invalid_output',
      requestId: 'req-0001-abcdef',
      promptVersion: 'weekly-summary/v3',
      attempts: 2,
      usage: { inputTokens: 2000, outputTokens: 200 },
    });
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it('treats an answer cut off by the token limit as bad and says so on the retry', async () => {
    const cut = answer('{"headline":"Dziewięć', [1000, 100], 'length');
    const model = mockModel(cut, answer(GOOD));
    const result = await call(handlerWith(model), post(requestBody()));
    expect(result.body).toMatchObject({ kind: 'ok', validationOutcome: 'ok_after_repair' });
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain('cut off');
  });

  it('never validates against the first attempt after a repair', async () => {
    const model = mockModel(
      answer({ ...GOOD, flags: [{ code: 'SPARSE_HISTORY', comment: 'x' }] }),
      answer(GOOD),
    );
    const result = await call(handlerWith(model), post(requestBody()));
    expect(result.body.summary).toEqual(GOOD);
  });
});

describe('failures upstream', () => {
  const failing = (error: Error) =>
    new MockLanguageModelV4({
      modelId: 'mock-coach',
      doGenerate: async () => {
        throw error;
      },
    });
  const apiError = (statusCode: number, isRetryable: boolean) =>
    new APICallError({
      message: 'upstream said no',
      url: 'https://provider.test',
      requestBodyValues: {},
      statusCode,
      isRetryable,
    });

  it('marks a 5xx as worth trying again', async () => {
    const result = await call(handlerWith(failing(apiError(503, true))), post(requestBody()));
    expect(result.status).toBe(502);
    expect(result.body).toEqual({ kind: 'upstream_error', retryable: true });
  });

  it('marks a 4xx as not worth trying again', async () => {
    const result = await call(handlerWith(failing(apiError(400, false))), post(requestBody()));
    expect(result.body).toEqual({ kind: 'upstream_error', retryable: false });
  });

  it('does not retry on an error it does not recognise', async () => {
    const result = await call(handlerWith(failing(new Error('boom'))), post(requestBody()));
    expect(result.body).toEqual({ kind: 'upstream_error', retryable: false });
  });

  it('keeps provider error text out of the response', async () => {
    const result = await call(handlerWith(failing(apiError(503, true))), post(requestBody()));
    expect(result.text).not.toContain('upstream said no');
  });

  it('answers 504 when the provider takes too long', async () => {
    const hanging = new MockLanguageModelV4({
      modelId: 'mock-coach',
      doGenerate: ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal?.addEventListener('abort', () => reject(abortSignal.reason));
        }),
    });
    const result = await call(handlerWith(hanging, { timeoutMs: 20 }), post(requestBody()));
    expect(result.status).toBe(504);
    expect(result.body).toEqual({ kind: 'timeout' });
  });

  it('stops quietly when the app closes the connection', async () => {
    const controller = new AbortController();
    const hanging = new MockLanguageModelV4({
      modelId: 'mock-coach',
      doGenerate: ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal?.addEventListener('abort', () => reject(abortSignal.reason));
          controller.abort();
        }),
    });
    const request = new Request(post(requestBody()), { signal: controller.signal });
    const result = await call(handlerWith(hanging), request);
    expect(result.status).toBe(499);
  });
});

describe('the daily budget', () => {
  it('counts the tokens of a successful call', async () => {
    const day = freshDay();
    const env = testEnv();
    const handler = createHandler({
      model: () => mockModel(answer(GOOD, [900, 100])),
      now: () => day,
    });
    await call(handler, post(requestBody()), env);
    expect(await env.BUDGET.get(`tokens:${day.toISOString().slice(0, 10)}`)).toBe('1000');
  });

  it('counts the tokens of a call that produced nothing usable', async () => {
    const day = freshDay();
    const env = testEnv();
    const model = mockModel(answer('x', [500, 50]), answer('y', [500, 50]));
    await call(createHandler({ model: () => model, now: () => day }), post(requestBody()), env);
    expect(await env.BUDGET.get(`tokens:${day.toISOString().slice(0, 10)}`)).toBe('1100');
  });

  it('stops before calling the model once the day is spent', async () => {
    const day = freshDay();
    const env = testEnv({ DAILY_TOKEN_BUDGET: '1000' });
    await env.BUDGET.put(`tokens:${day.toISOString().slice(0, 10)}`, '1000');
    const model = mockModel(answer(GOOD));
    const result = await call(
      createHandler({ model: () => model, now: () => day }),
      post(requestBody()),
      env,
    );
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ kind: 'budget_exhausted' });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('starts afresh the next day', async () => {
    const env = testEnv({ DAILY_TOKEN_BUDGET: '1000' });
    const yesterday = freshDay();
    await env.BUDGET.put(`tokens:${yesterday.toISOString().slice(0, 10)}`, '1000');
    const today = freshDay();
    const result = await call(
      createHandler({ model: () => mockModel(answer(GOOD)), now: () => today }),
      post(requestBody()),
      env,
    );
    expect(result.status).toBe(200);
  });

  it('is not charged for a call that failed before spending anything', async () => {
    const day = freshDay();
    const env = testEnv();
    const failing = new MockLanguageModelV4({
      modelId: 'mock-coach',
      doGenerate: async () => {
        throw new Error('down');
      },
    });
    await call(createHandler({ model: () => failing, now: () => day }), post(requestBody()), env);
    expect(await env.BUDGET.get(`tokens:${day.toISOString().slice(0, 10)}`)).toBeNull();
  });
});

describe('the log', () => {
  const lines = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);

  it('writes one metadata line per call', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await call(handlerWith(mockModel(answer(GOOD, [1200, 150]))), post(requestBody()));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(lines(spy)[0]).toMatchObject({
      event: 'weekly_summary',
      requestId: 'req-0001-abcdef',
      contractVersion: CONTRACT_VERSION,
      promptVersion: 'weekly-summary/v3',
      provider: expect.any(String),
      model: 'mock-coach',
      tokensIn: 1200,
      tokensOut: 150,
      attempts: 1,
      outcome: 'ok',
      status: 200,
      latencyMs: expect.any(Number),
      estimatedCostUsd: null,
    });
  });

  it('never contains anything the person or the model wrote', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const withNote = {
      ...context,
      notes: [{ date: '2026-09-30', source: 'daily' as const, text: 'sekretna notatka o kolanie' }],
    };
    await call(handlerWith(mockModel(answer(GOOD))), post(requestBody(withNote)));
    const everything = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(everything).not.toContain('sekretna');
    expect(everything).not.toContain(GOOD.headline);
    expect(everything).not.toContain(SECRET);
  });

  it('records a rejection and an outcome for a failure, but not for a stranger', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await call(handlerWith(mockModel(answer(GOOD))), post(requestBody(), {})); // unauthenticated
    expect(spy).not.toHaveBeenCalled();

    await call(handlerWith(mockModel(answer(GOOD))), post('{oops'));
    expect(lines(spy)[0]).toMatchObject({ outcome: 'rejected', status: 400, requestId: null });
  });

  it('estimates the cost when prices are configured', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = testEnv({ PRICE_INPUT_USD_PER_MTOK: '0.5', PRICE_OUTPUT_USD_PER_MTOK: '2' });
    await call(
      handlerWith(mockModel(answer(GOOD, [1_000_000, 500_000]))),
      post(requestBody()),
      env,
    );
    expect(lines(spy)[0]!.estimatedCostUsd).toBeCloseTo(1.5);
  });

  it('records a repaired answer as such', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await call(handlerWith(mockModel(answer('{'), answer(GOOD))), post(requestBody()));
    expect(lines(spy)[0]).toMatchObject({ outcome: 'ok_after_repair', attempts: 2 });
  });
});

describe('response shape', () => {
  it('every kind the handler can return is one the contract knows', async () => {
    const results: WeeklySummaryResponse[] = [];
    const run = async (
      handler: ExportedHandler<ReturnType<typeof testEnv>>,
      request: Request,
      env = testEnv(),
    ) => results.push((await call(handler, request, env)).body);

    await run(handlerWith(mockModel(answer(GOOD))), post(requestBody()));
    await run(handlerWith(mockModel(answer('x'), answer('y'))), post(requestBody()));
    await run(handlerWith(null), post(requestBody()));
    await run(handlerWith(mockModel(answer(GOOD))), post('{'));
    await run(handlerWith(mockModel(answer(GOOD))), post(requestBody(), {}));

    for (const body of results)
      expect(weeklySummaryResponseSchema.safeParse(body).success).toBe(true);
  });
});

describe('the weekly summary: provider settings and failures', () => {
  it('tells the provider the configured thinking level', async () => {
    const model = mockModel(answer(GOOD));
    const env = testEnv({ THINKING_LEVEL: 'minimal' });
    await call(handlerWith(model), post(requestBody()), env);
    expect(model.doGenerateCalls[0]!.providerOptions).toEqual({
      google: { thinkingConfig: { thinkingLevel: 'minimal' } },
    });
  });

  it('logs the status a provider refused with, and not what it said', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const model = new MockLanguageModelV4({
      modelId: 'mock-coach',
      doGenerate: async () => {
        throw new APICallError({
          message: 'API key not valid. Please pass a valid API key.',
          url: 'https://p',
          requestBodyValues: {},
          statusCode: 400,
        });
      },
    });
    await call(handlerWith(model), post(requestBody()));
    const logged = spy.mock.calls.map((c) => String(c[0]));
    expect(JSON.parse(logged.at(-1)!)).toMatchObject({
      outcome: 'upstream_error',
      upstreamStatus: 400,
    });
    expect(logged.join('\n')).not.toContain('API key not valid');
  });
});
