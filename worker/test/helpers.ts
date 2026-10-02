import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { env as workerEnv } from 'cloudflare:workers';

import type { ChatEvent, ChatFacts, ChatMessage } from '../../src/ai/contract/chat';
import { chatEventSchema } from '../../src/ai/contract/chat';
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
  sessionCount: 0,
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
    // What a deployment tunes (wrangler.jsonc) is pinned here, so that tuning never changes a test.
    MAX_OUTPUT_TOKENS: '900',
    THINKING_LEVEL: '',
    PRICE_INPUT_USD_PER_MTOK: '',
    PRICE_OUTPUT_USD_PER_MTOK: '',
    LIMITER: openLimiter,
    CHAT_LIMITER: openLimiter,
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

// --- the chat ---------------------------------------------------------------

export const URL_CHAT = 'https://coach.test/v1/chat';

export const facts: ChatFacts = {
  asOf: '2026-10-01',
  historicalSessionCount: 12,
  signals: [],
  constraints: ['knee_no_frontal_plane_under_load'],
};

export const sparseFacts: ChatFacts = {
  ...facts,
  historicalSessionCount: 2,
  signals: ['SPARSE_HISTORY'],
};

export const chatBody = (
  messages: ChatMessage[],
  overrides: { facts?: ChatFacts; requestId?: string } = {},
) => ({
  contractVersion: CONTRACT_VERSION,
  requestId: overrides.requestId ?? 'req-chat-0001',
  facts: overrides.facts ?? facts,
  messages,
});

export const ask = (text = 'Jak idzie wiosłowanie?'): ChatMessage => ({ role: 'user', text });

export function postChat(
  body: unknown,
  headers: Record<string, string> = { 'x-app-secret': SECRET },
  signal?: AbortSignal,
) {
  return new Request(URL_CHAT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal,
  });
}

/** An execution context that remembers what the Worker asked to keep alive. */
export function recordingCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
      passThroughOnException() {},
    } as unknown as ExecutionContext,
    settled: () => Promise.all(pending),
  };
}

type Chunk = Record<string, unknown>;

const finishChunk = (
  reason: 'stop' | 'tool-calls' | 'length' = 'stop',
  tokens: [number, number] = [1000, 60],
): Chunk => ({
  type: 'finish',
  finishReason: { unified: reason, raw: reason },
  usage: usage(...tokens),
});

/** A step that streams text in pieces and stops. */
export const textStep = (pieces: string[], tokens?: [number, number]): Chunk[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't1' },
  ...pieces.map((delta) => ({ type: 'text-delta', id: 't1', delta })),
  { type: 'text-end', id: 't1' },
  finishChunk('stop', tokens),
];

/** A step that asks for tools. */
export const callStep = (
  calls: { id: string; name: string; input: unknown }[],
  tokens?: [number, number],
): Chunk[] => [
  { type: 'stream-start', warnings: [] },
  ...calls.map((c) => ({
    type: 'tool-call',
    toolCallId: c.id,
    toolName: c.name,
    input: JSON.stringify(c.input),
  })),
  finishChunk('tool-calls', tokens),
];

export const streamResult = (chunks: Chunk[]) => ({
  stream: simulateReadableStream({ chunks: chunks as never[] }),
});

/** A model whose steps are the given chunk lists, in order. */
export const streamingModel = (...steps: Chunk[][]) =>
  new MockLanguageModelV4({
    modelId: 'mock-coach',
    doStream: steps.length === 1 ? streamResult(steps[0]!) : steps.map(streamResult),
  });

/** Every event of an NDJSON answer, each checked against the contract. */
export async function readEvents(response: Response): Promise<ChatEvent[]> {
  // Not `.text()`: workerd warns that an NDJSON body "does not appear to be text".
  const text = new TextDecoder().decode(await response.arrayBuffer());
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => chatEventSchema.parse(JSON.parse(line)));
}
