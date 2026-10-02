import { describe, expect, it } from 'vitest';

import { constantTimeEqual, isAuthorized } from '../src/auth';
import { dailyBudget } from '../src/budget';
import { estimateCostUsd, logRecord, type LogRecord } from '../src/log';
import { providerOptionsFromEnv } from '../src/model';
import { freshDay, testEnv } from './helpers';

describe('constantTimeEqual', () => {
  it('is true only for identical strings', () => {
    expect(constantTimeEqual('secret', 'secret')).toBe(true);
    expect(constantTimeEqual('secret', 'Secret')).toBe(false);
    expect(constantTimeEqual('secret', 'secre')).toBe(false);
    expect(constantTimeEqual('secre', 'secret')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
    expect(constantTimeEqual('', 'x')).toBe(false);
  });

  it('compares bytes, so multi-byte characters are not confused with look-alikes', () => {
    expect(constantTimeEqual('zażółć', 'zażółć')).toBe(true);
    expect(constantTimeEqual('zażółć', 'zazolc')).toBe(false);
  });
});

describe('isAuthorized', () => {
  const request = (headers: Record<string, string>) => new Request('https://x.test', { headers });

  it('accepts the configured secret', () => {
    expect(isAuthorized(request({ 'x-app-secret': 's3cret' }), 's3cret')).toBe(true);
  });

  it('refuses a missing or wrong header', () => {
    expect(isAuthorized(request({}), 's3cret')).toBe(false);
    expect(isAuthorized(request({ 'x-app-secret': 'other' }), 's3cret')).toBe(false);
  });

  it('refuses everyone when no secret is configured, even an empty header', () => {
    expect(isAuthorized(request({ 'x-app-secret': '' }), undefined)).toBe(false);
    expect(isAuthorized(request({ 'x-app-secret': '' }), '')).toBe(false);
  });
});

describe('dailyBudget', () => {
  const { BUDGET } = testEnv();

  it('has room until the limit is reached', async () => {
    const budget = dailyBudget(BUDGET, 100, freshDay());
    expect(await budget.hasRoom()).toBe(true);
    await budget.spend(60);
    expect(await budget.hasRoom()).toBe(true);
    await budget.spend(40);
    expect(await budget.hasRoom()).toBe(false);
  });

  it('keeps a separate count per UTC day', async () => {
    const first = freshDay();
    await dailyBudget(BUDGET, 10, first).spend(10);
    expect(await dailyBudget(BUDGET, 10, first).hasRoom()).toBe(false);
    expect(await dailyBudget(BUDGET, 10, freshDay()).hasRoom()).toBe(true);
  });

  it('writes nothing for no tokens', async () => {
    const day = freshDay();
    await dailyBudget(BUDGET, 10, day).spend(0);
    await dailyBudget(BUDGET, 10, day).spend(-5);
    expect(await BUDGET.get(`tokens:${day.toISOString().slice(0, 10)}`)).toBeNull();
  });

  it('treats a damaged counter as empty rather than locking the app out', async () => {
    const day = freshDay();
    await BUDGET.put(`tokens:${day.toISOString().slice(0, 10)}`, 'garbage');
    expect(await dailyBudget(BUDGET, 10, day).hasRoom()).toBe(true);
  });

  it('lets the counter expire by itself', async () => {
    const day = freshDay();
    await dailyBudget(BUDGET, 10, day).spend(1);
    const { metadata } = await BUDGET.getWithMetadata(`tokens:${day.toISOString().slice(0, 10)}`);
    expect(metadata ?? null).toBeNull(); // the TTL is set on put; expiry itself is KV's job
  });
});

describe('estimateCostUsd', () => {
  it('is null unless both prices are configured and numeric', () => {
    expect(estimateCostUsd(1000, 100, {})).toBeNull();
    expect(estimateCostUsd(1000, 100, { PRICE_INPUT_USD_PER_MTOK: '1' })).toBeNull();
    expect(
      estimateCostUsd(1000, 100, { PRICE_INPUT_USD_PER_MTOK: '1', PRICE_OUTPUT_USD_PER_MTOK: '' }),
    ).toBeNull();
    expect(
      estimateCostUsd(1000, 100, { PRICE_INPUT_USD_PER_MTOK: 'a', PRICE_OUTPUT_USD_PER_MTOK: '2' }),
    ).toBeNull();
  });

  it('prices input and output per million tokens', () => {
    const prices = { PRICE_INPUT_USD_PER_MTOK: '0.5', PRICE_OUTPUT_USD_PER_MTOK: '2' };
    expect(estimateCostUsd(2_000_000, 1_000_000, prices)).toBeCloseTo(3);
    expect(estimateCostUsd(0, 0, prices)).toBe(0);
  });
});

describe('logRecord', () => {
  it('writes the record as one JSON line to the sink', () => {
    const record: LogRecord = {
      event: 'weekly_summary',
      requestId: 'r',
      contractVersion: 1,
      promptVersion: 'weekly-summary/v1',
      provider: 'google',
      model: 'm',
      tokensIn: 1,
      tokensOut: 2,
      latencyMs: 3,
      attempts: 1,
      outcome: 'ok',
      status: 200,
      estimatedCostUsd: null,
    };
    const lines: string[] = [];
    logRecord(record, (line) => lines.push(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\n');
    expect(JSON.parse(lines[0]!)).toEqual(record);
  });
});

describe('providerOptionsFromEnv', () => {
  it('turns a known thinking level into the Gemini setting', () => {
    for (const level of ['minimal', 'low', 'medium', 'high']) {
      expect(providerOptionsFromEnv({ PROVIDER: 'google', THINKING_LEVEL: level })).toEqual({
        google: { thinkingConfig: { thinkingLevel: level } },
      });
    }
  });

  it('leaves the provider default alone when nothing, or something unknown, is configured', () => {
    expect(providerOptionsFromEnv({ PROVIDER: 'google' })).toBeUndefined();
    expect(providerOptionsFromEnv({ PROVIDER: 'google', THINKING_LEVEL: '' })).toBeUndefined();
    expect(
      providerOptionsFromEnv({ PROVIDER: 'google', THINKING_LEVEL: 'extreme' }),
    ).toBeUndefined();
    expect(providerOptionsFromEnv({ PROVIDER: 'google', THINKING_LEVEL: 'LOW' })).toBeUndefined();
  });

  it('does not send a Google setting to another provider', () => {
    expect(providerOptionsFromEnv({ PROVIDER: 'fake', THINKING_LEVEL: 'low' })).toBeUndefined();
  });
});
