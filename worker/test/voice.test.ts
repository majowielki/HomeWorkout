import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONTRACT_VERSION } from '../../src/ai/contract/versions';
import { voiceIntentResponseSchema } from '../../src/ai/contract/voiceIntent';
import { VOICE_INTENT_PROMPT_VERSION } from '../../src/ai/prompts/voiceIntent/v1';
import { fakeModel } from '../src/fakeModel';
import { createHandler } from '../src/index';
import { VOICE_MAX_OUTPUT_TOKENS } from '../src/voiceRoute';
import { answer, ctx, freshDay, mockModel, SECRET, testEnv } from './helpers';

const URL_VOICE = 'https://coach.test/v1/voice-intent';

const body = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: CONTRACT_VERSION,
  requestId: 'req-voice-0001',
  transcript: 'lecę dalej z tym',
  alternatives: ['lecę dalej'],
  available: ['rest_end', 'rest_extend', 'skip_exercise'],
  ...overrides,
});

function postVoice(payload: unknown, signal?: AbortSignal) {
  return new Request(URL_VOICE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-secret': SECRET },
    body: JSON.stringify(payload),
    signal,
  });
}

async function run(model: MockLanguageModelV4 | null, payload: unknown, extra = {}) {
  const handler = createHandler({ model: () => model, now: freshDay, ...extra });
  const response = await handler.fetch!(postVoice(payload) as never, testEnv(), ctx);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

afterEach(() => vi.restoreAllMocks());

describe('POST /v1/voice-intent', () => {
  it('answers with the action the model chose, in the contract', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const model = mockModel(answer({ action: 'rest_end' }, [300, 4]));
    const result = await run(model, body());
    expect(result.status).toBe(200);
    expect(voiceIntentResponseSchema.parse(result.body)).toEqual({
      kind: 'ok',
      requestId: 'req-voice-0001',
      promptVersion: VOICE_INTENT_PROMPT_VERSION,
      model: 'mock-coach',
      usage: { inputTokens: 300, outputTokens: 4 },
      action: 'rest_end',
      validationOutcome: 'ok',
    });
  });

  it('sends the offered actions and the heard text, and caps the output', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const model = mockModel(answer({ action: 'unknown' }));
    await run(model, body());
    const call = model.doGenerateCalls[0]!;
    const prompt = JSON.stringify(call.prompt);
    expect(prompt).toContain('- rest_end:');
    expect(prompt).toContain('- skip_exercise:');
    expect(prompt).not.toContain('set_done');
    expect(prompt).toContain('lecę dalej z tym');
    expect(call.maxOutputTokens).toBe(Math.min(900, VOICE_MAX_OUTPUT_TOKENS));
    expect(call.temperature).toBe(0);
    // The schema the provider fills offers only these actions and "unknown".
    const format = call.responseFormat as { type: string; schema: { properties: unknown } };
    expect(JSON.stringify(format.schema)).not.toContain('set_done');
    expect(JSON.stringify(format.schema)).toContain('unknown');
  });

  it('turns an action that was not offered, or an unreadable answer, into unknown', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const raw of [{ action: 'set_done' }, 'not json at all', { action: 7 }]) {
      const result = await run(mockModel(answer(raw)), body());
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ action: 'unknown', validationOutcome: 'invalid_output' });
    }
  });

  it('logs metadata only: never the heard text', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run(mockModel(answer({ action: 'rest_extend' })), body());
    const line = String(spy.mock.calls.at(-1)?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      event: 'voice_intent',
      outcome: 'ok',
      status: 200,
      attempts: 1,
      promptVersion: VOICE_INTENT_PROMPT_VERSION,
    });
    expect(line).not.toContain('lecę');
  });

  it.each([
    ['an empty transcript', { transcript: '  ' }],
    ['a transcript too long to be a command', { transcript: 'a'.repeat(121) }],
    ['no actions', { available: [] }],
    ['an action twice', { available: ['rest_end', 'rest_end'] }],
    ['an action that does not exist', { available: ['finish_workout'] }],
    ['too many alternatives', { alternatives: ['a', 'b', 'c', 'd'] }],
  ])('refuses %s before any model call', async (_name, overrides) => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const model = mockModel(answer({ action: 'rest_end' }));
    const result = await run(model, body(overrides));
    expect(result.status).toBe(400);
    expect(result.body.kind).toBe('bad_request');
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('refuses another contract version with a typed mismatch', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await run(
      mockModel(answer({ action: 'rest_end' })),
      body({ contractVersion: CONTRACT_VERSION - 1 }),
    );
    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      kind: 'contract_mismatch',
      expected: CONTRACT_VERSION,
      got: CONTRACT_VERSION - 1,
    });
  });

  it('reports a provider error with its retry flag, and a slow provider as a timeout', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const failing = new MockLanguageModelV4({
      modelId: 'mock-coach',
      doGenerate: async () => {
        throw new APICallError({
          message: 'overloaded',
          url: 'https://provider.test',
          requestBodyValues: {},
          statusCode: 503,
          isRetryable: true,
        });
      },
    });
    expect((await run(failing, body())).body).toEqual({ kind: 'upstream_error', retryable: true });

    const slow = new MockLanguageModelV4({
      modelId: 'mock-coach',
      doGenerate: (options) =>
        new Promise((_resolve, reject) => {
          options.abortSignal?.addEventListener('abort', () => reject(options.abortSignal?.reason));
        }),
    });
    const result = await run(slow, body(), { voiceTimeoutMs: 20 });
    expect(result.status).toBe(504);
    expect(result.body).toEqual({ kind: 'timeout' });
  });

  it('the fake model picks the first action for "atrapa" and unknown otherwise', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect((await run(fakeModel(), body({ transcript: 'atrapa' }))).body.action).toBe('rest_end');
    expect((await run(fakeModel(), body())).body.action).toBe('unknown');
  });
});
