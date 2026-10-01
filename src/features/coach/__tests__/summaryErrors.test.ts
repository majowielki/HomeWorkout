import type { ClientFailure } from '@/ai/client/coachClient';
import { apiErrorSchema } from '@/ai/contract/weeklySummary';

import { describeFailure } from '../summaryErrors';

const usage = { inputTokens: 1, outputTokens: 1 };

/** One example of every failure the app can see, server-side and client-side. */
const EVERY_FAILURE: ClientFailure[] = [
  { kind: 'unauthorized' },
  { kind: 'not_found' },
  { kind: 'payload_too_large' },
  { kind: 'bad_request', issues: 1 },
  { kind: 'contract_mismatch', expected: 1, got: 2 },
  { kind: 'rate_limited' },
  { kind: 'budget_exhausted' },
  { kind: 'invalid_output', requestId: 'r', promptVersion: 'v', attempts: 2, usage },
  { kind: 'upstream_error', retryable: true },
  { kind: 'timeout' },
  { kind: 'misconfigured' },
  { kind: 'offline' },
  { kind: 'client_timeout' },
  { kind: 'aborted' },
  { kind: 'protocol_error' },
];

describe('describeFailure', () => {
  it('has a sentence for every failure the contract can produce', () => {
    // If the contract grows a kind, this list must grow with it.
    const serverKinds = apiErrorSchema.options.map((o) => o.shape.kind.value);
    const covered = new Set(EVERY_FAILURE.map((f) => f.kind));
    expect(serverKinds.filter((k) => !covered.has(k))).toEqual([]);
  });

  it.each(EVERY_FAILURE.filter((f) => f.kind !== 'aborted'))(
    'says something readable for %j',
    (failure) => {
      const view = describeFailure(failure);
      expect(view).not.toBeNull();
      expect(view!.text.length).toBeGreaterThan(10);
    },
  );

  it('says nothing when the person cancelled', () => {
    expect(describeFailure({ kind: 'aborted' })).toBeNull();
  });

  it.each([
    'offline',
    'client_timeout',
    'timeout',
    'rate_limited',
    'upstream_error',
    'invalid_output',
  ])('lets the person try again after %s', (kind) => {
    const failure = EVERY_FAILURE.find((f) => f.kind === kind)!;
    expect(describeFailure(failure)!.canRetry).toBe(true);
  });

  it.each([
    'budget_exhausted',
    'unauthorized',
    'contract_mismatch',
    'misconfigured',
    'not_found',
    'bad_request',
    'payload_too_large',
    'protocol_error',
  ])('does not offer a retry that cannot help after %s', (kind) => {
    const failure = EVERY_FAILURE.find((f) => f.kind === kind)!;
    expect(describeFailure(failure)!.canRetry).toBe(false);
  });

  it('tells a person with no network that the rest of the app is unaffected', () => {
    expect(describeFailure({ kind: 'offline' })!.text).toMatch(/Reszta aplikacji działa/);
  });
});
