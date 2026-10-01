import { MockLanguageModelV4 } from 'ai/test';
import { env as workerEnv } from 'cloudflare:workers';

import type { CoachContext } from '../../src/ai/contract/coachContext';
import { CONTRACT_VERSION } from '../../src/ai/contract/versions';
import type { WeeklySummary } from '../../src/ai/contract/weeklySummary';
import type { Env } from '../src/env';

export const SECRET = 'test-secret';
export const URL_SUMMARY = 'https://coach.test/v1/weekly-summary';

/** A small but complete context. The shared fixtures live in the app; the Worker cannot import them. */
export const context: CoachContext = {
  asOf: '2026-10-01',
  windowDays: 28,
  goal: 'lean_mass_retention_in_deficit',
  constraints: ['knee_no_frontal_plane_under_load'],
  historicalSessionCount: 12,
  signals: [],
  sessions: [],
  weeklyVolume: [],
  trends: [],
  trendSummary: { improved: 0, maintained: 0, declined: 0 },
  weight: null,
  waist: null,
  recovery: {
    daysLogged: 0,
    avgSleepHours: null,
    avgEnergy: null,
    avgStress: null,
    highSoreness: [],
  },
  notes: [],
};

export const sparseContext: CoachContext = {
  ...context,
  historicalSessionCount: 2,
  signals: ['SPARSE_HISTORY'],
};

export const requestBody = (ctx: CoachContext = context, requestId = 'req-0001-abcdef') => ({
  contractVersion: CONTRACT_VERSION,
  requestId,
  context: ctx,
});

export const GOOD: WeeklySummary = {
  headline: 'Dziewięć sesji w cztery tygodnie.',
  highlights: ['Siła utrzymana przy spadającej wadze.'],
  flags: [],
  questions: [],
};

export const usage = (input = 1000, output = 100) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

export const answer = (
  value: unknown,
  tokens: [number, number] = [1000, 100],
  finish: 'stop' | 'length' = 'stop',
) => ({
  content: [
    { type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) },
  ],
  finishReason: { unified: finish, raw: finish },
  usage: usage(...tokens),
  warnings: [],
});

export const mockModel = (...results: ReturnType<typeof answer>[]) =>
  new MockLanguageModelV4({
    modelId: 'mock-coach',
    doGenerate: results.length === 1 ? results[0]! : results,
  });

const openLimiter = { limit: async () => ({ success: true }) } as unknown as RateLimit;

/** The real KV and the real variables from wrangler.jsonc, with a few overrides. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...(workerEnv as unknown as Env),
    APP_SECRET: SECRET,
    MODEL_ID: 'mock-coach',
    LIMITER: openLimiter,
    ...overrides,
  };
}

export const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

export function post(body: unknown, headers: Record<string, string> = { 'x-app-secret': SECRET }) {
  return new Request(URL_SUMMARY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

let day = 0;
/** A different UTC day per call, so tests never share a budget counter in KV. */
export function freshDay(): Date {
  day += 1;
  return new Date(Date.UTC(2030, 0, day));
}
