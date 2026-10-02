import type { ChatFacts } from '../../contract/chat';
import { buildCoachContext } from '../../context/buildCoachContext';
import { scenario } from '../../testing/synthetic';
import type { CallOutcome } from '../coachClient';
import { toChatExchangeRecord, toExchangeRecord } from '../exchange';

const context = buildCoachContext(scenario()).context;
const usage = { inputTokens: 1200, outputTokens: 150 };

const call = (result: CallOutcome['result']): CallOutcome => ({
  requestId: 'req-0001-abcdef',
  result,
  attempts: 2,
  latencyMs: 3400,
});

describe('toExchangeRecord', () => {
  it('keeps everything about a good answer', () => {
    const ok = {
      kind: 'ok' as const,
      requestId: 'req-0001-abcdef',
      promptVersion: 'weekly-summary/v1',
      model: 'some-model',
      usage,
      validationOutcome: 'ok_after_repair' as const,
      summary: { headline: 'h', highlights: ['a'], flags: [], questions: [] },
    };
    expect(toExchangeRecord(context, call(ok))).toEqual({
      kind: 'weekly_summary',
      requestId: 'req-0001-abcdef',
      promptVersion: 'weekly-summary/v1',
      model: 'some-model',
      latencyMs: 3400,
      tokensIn: 1200,
      tokensOut: 150,
      attempts: 2,
      outcome: 'ok_after_repair',
      request: context,
      response: ok,
    });
  });

  it('keeps the spend of an answer that failed validation', () => {
    const invalid = {
      kind: 'invalid_output' as const,
      requestId: 'req-0001-abcdef',
      promptVersion: 'weekly-summary/v1',
      attempts: 2,
      usage,
    };
    expect(toExchangeRecord(context, call(invalid))).toMatchObject({
      outcome: 'invalid_output',
      promptVersion: 'weekly-summary/v1',
      model: null,
      tokensIn: 1200,
      tokensOut: 150,
    });
  });

  it.each([
    [{ kind: 'offline' as const }],
    [{ kind: 'client_timeout' as const }],
    [{ kind: 'unauthorized' as const }],
    [{ kind: 'budget_exhausted' as const }],
    [{ kind: 'upstream_error' as const, retryable: true }],
    [{ kind: 'protocol_error' as const }],
  ])('records %j by its kind, with no metadata it never received', (result) => {
    expect(toExchangeRecord(context, call(result))).toMatchObject({
      outcome: result.kind,
      promptVersion: null,
      model: null,
      tokensIn: null,
      tokensOut: null,
      requestId: 'req-0001-abcdef',
      response: result,
    });
  });

  it('records nothing for a call the person cancelled', () => {
    expect(toExchangeRecord(context, call({ kind: 'aborted' }))).toBeNull();
  });
});

describe('toChatExchangeRecord', () => {
  const facts: ChatFacts = {
    asOf: '2026-10-01',
    historicalSessionCount: 12,
    signals: [],
    constraints: [],
  };

  const meta = {
    requestIds: ['req-1-aaaaaaa', 'req-2-bbbbbbb'],
    promptVersion: 'chat/v1',
    model: 'some-model',
    rounds: 1,
    tools: ['getWeeklyVolume' as const],
    usage: { inputTokens: 2000, outputTokens: 90 },
    latencyMs: 5200,
    messages: [{ role: 'user' as const, text: 'Ile serii na plecy?' }],
  };

  it('keeps the conversation, the answer and what it cost', () => {
    const record = toChatExchangeRecord(facts, {
      ...meta,
      kind: 'answered',
      text: 'Sześć serii.',
      truncated: false,
      history: [],
    });
    expect(record).toEqual({
      kind: 'chat',
      requestId: 'req-1-aaaaaaa',
      promptVersion: 'chat/v1',
      model: 'some-model',
      latencyMs: 5200,
      tokensIn: 2000,
      tokensOut: 90,
      attempts: 2,
      outcome: 'ok',
      request: { facts, messages: meta.messages },
      response: {
        text: 'Sześć serii.',
        tools: ['getWeeklyVolume'],
        rounds: 1,
        requestIds: meta.requestIds,
      },
    });
  });

  it('says so when the answer was cut off', () => {
    const record = toChatExchangeRecord(facts, {
      ...meta,
      kind: 'answered',
      text: 'Urwane',
      truncated: true,
      history: [],
    });
    expect(record?.outcome).toBe('truncated');
  });

  it('keeps a withheld reply, with the rules it broke, so "why did it say that?" has an answer', () => {
    const record = toChatExchangeRecord(facts, {
      ...meta,
      kind: 'withheld',
      text: 'Zjedz więcej białka.',
      violations: ['out_of_scope'],
    });
    expect(record).toMatchObject({
      outcome: 'withheld',
      response: { withheld: 'Zjedz więcej białka.', violations: ['out_of_scope'] },
    });
  });

  it('records a failure by its kind, with the text that had been shown', () => {
    const record = toChatExchangeRecord(facts, {
      ...meta,
      kind: 'failed',
      failure: { kind: 'tool_limit' },
      partialText: 'Sprawdzam.',
    });
    expect(record).toMatchObject({
      outcome: 'tool_limit',
      response: { failure: { kind: 'tool_limit' }, partialText: 'Sprawdzam.' },
    });
  });

  it('keeps nothing of a cancelled turn', () => {
    expect(toChatExchangeRecord(facts, { ...meta, kind: 'aborted' })).toBeNull();
  });

  it('keeps nothing of a message the gate stopped, whose text is the very thing it refuses to pass on', () => {
    expect(
      toChatExchangeRecord(facts, {
        ...meta,
        requestIds: [],
        kind: 'blocked',
        gate: { kind: 'medical' },
      }),
    ).toBeNull();
  });

  it('has an empty request id for a turn that never got as far as one', () => {
    const record = toChatExchangeRecord(facts, {
      ...meta,
      requestIds: [],
      kind: 'failed',
      failure: { kind: 'offline' },
      partialText: '',
    });
    expect(record?.requestId).toBe('');
  });
});
