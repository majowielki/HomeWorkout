import { buildCoachContext } from '../../context/buildCoachContext';
import { scenario } from '../../testing/synthetic';
import type { CallOutcome } from '../coachClient';
import { toExchangeRecord } from '../exchange';

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
