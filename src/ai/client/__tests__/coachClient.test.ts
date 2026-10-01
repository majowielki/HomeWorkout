import { buildCoachContext } from '../../context/buildCoachContext';
import { CONTRACT_VERSION } from '../../contract/versions';
import { weeklySummaryRequestSchema } from '../../contract/weeklySummary';
import { scenario } from '../../testing/synthetic';
import {
  backoffMs,
  createCoachClient,
  DEFAULT_TIMEOUT_MS,
  MAX_RETRIES,
  type ClientDeps,
} from '../coachClient';

const config = { baseUrl: 'https://coach.test', secret: 's3cret' };
const context = buildCoachContext(scenario()).context;

const usage = { inputTokens: 1200, outputTokens: 150 };
const OK = {
  kind: 'ok',
  requestId: 'req-0001-abcdef',
  promptVersion: 'weekly-summary/v1',
  model: 'm',
  usage,
  validationOutcome: 'ok',
  summary: { headline: 'h', highlights: ['a'], flags: [], questions: [] },
};
const UPSTREAM = { kind: 'upstream_error', retryable: true };

/** Just enough of a Response: the client only reads `.json()`. */
const reply = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

function harness(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  let i = 0;
  let clock = 1000;
  const deps: Pick<ClientDeps, 'newRequestId'> & Partial<ClientDeps> = {
    newRequestId: () => 'req-0001-abcdef',
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = responses[Math.min(i, responses.length - 1)]!;
      i += 1;
      if (next instanceof Error) throw next;
      return next;
    }) as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0.5,
    now: () => (clock += 10),
  };
  return { client: createCoachClient(config, deps), calls, sleeps };
}

describe('the request', () => {
  it('posts the contract to the Worker with the shared secret', async () => {
    const { client, calls } = harness([reply(OK)]);
    await client.weeklySummary(context);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://coach.test/v1/weekly-summary');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers).toEqual({
      'content-type': 'application/json',
      'x-app-secret': 's3cret',
    });
    const sent = weeklySummaryRequestSchema.parse(JSON.parse(String(calls[0]!.init.body)));
    expect(sent).toMatchObject({ contractVersion: CONTRACT_VERSION, requestId: 'req-0001-abcdef' });
    expect(sent.context).toEqual(context);
  });

  it('refuses to send a context the contract would reject', async () => {
    const { client, calls } = harness([reply(OK)]);
    const broken = { ...context, windowDays: -1 };
    await expect(client.weeklySummary(broken)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('the outcome', () => {
  it('returns an ok answer with the attempt count and the time taken', async () => {
    const { client } = harness([reply(OK)]);
    const outcome = await client.weeklySummary(context);
    expect(outcome.result).toEqual(OK);
    expect(outcome.attempts).toBe(1);
    expect(outcome.latencyMs).toBeGreaterThan(0);
  });

  it.each([
    [{ kind: 'unauthorized' }, 401],
    [{ kind: 'contract_mismatch', expected: 1, got: 2 }, 409],
    [{ kind: 'rate_limited' }, 429],
    [{ kind: 'budget_exhausted' }, 429],
    [{ kind: 'bad_request', issues: 2 }, 400],
    [{ kind: 'misconfigured' }, 500],
    [{ kind: 'timeout' }, 504],
    [{ kind: 'upstream_error', retryable: false }, 502],
    [
      {
        kind: 'invalid_output',
        requestId: 'req-0001-abcdef',
        promptVersion: 'v',
        attempts: 2,
        usage,
      },
      422,
    ],
  ])('passes %j through without retrying', async (body, status) => {
    const { client, calls, sleeps } = harness([reply(body, status)]);
    const outcome = await client.weeklySummary(context);
    expect(outcome.result).toEqual(body);
    expect(outcome.attempts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});

describe('retries', () => {
  it('repeats a failure the Worker marked as worth repeating, backing off', async () => {
    const { client, calls, sleeps } = harness([
      reply(UPSTREAM, 502),
      reply(UPSTREAM, 502),
      reply(OK),
    ]);
    const outcome = await client.weeklySummary(context);

    expect(outcome.result).toEqual(OK);
    expect(outcome.attempts).toBe(3);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]); // random() = 0.5 -> factor 1
  });

  it('gives up after the allowed retries and reports the failure', async () => {
    const { client, calls } = harness([reply(UPSTREAM, 502)]);
    const outcome = await client.weeklySummary(context);

    expect(outcome.result).toEqual(UPSTREAM);
    expect(outcome.attempts).toBe(MAX_RETRIES + 1);
    expect(calls).toHaveLength(MAX_RETRIES + 1);
  });

  it('does not retry a network failure: with no network, the person decides', async () => {
    const { client, calls, sleeps } = harness([new Error('Network request failed')]);
    const outcome = await client.weeklySummary(context);

    expect(outcome.result).toEqual({ kind: 'offline' });
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('stops retrying when the person cancels in between', async () => {
    const controller = new AbortController();
    const { client, calls } = harness([reply(UPSTREAM, 502)]);
    const outcome = await client.weeklySummary(context, {
      signal: controller.signal,
      // cancelled while the client sleeps between attempts
    });
    expect(outcome.attempts).toBe(3);
    controller.abort();
    const again = await client.weeklySummary(context, { signal: controller.signal });
    expect(again.result).toEqual({ kind: 'aborted' });
    expect(calls).toHaveLength(3);
  });
});

describe('backoffMs', () => {
  it('doubles with each retry and spreads by +-50%', () => {
    expect(backoffMs(1, () => 0)).toBe(250);
    expect(backoffMs(2, () => 0)).toBe(500);
    expect(backoffMs(1, () => 0.5)).toBe(500);
    expect(backoffMs(2, () => 0.5)).toBe(1000);
    expect(backoffMs(2, () => 0.999)).toBeCloseTo(1499, 0);
  });
});

describe('an answer the app cannot read', () => {
  it('is a protocol error when the body is not JSON', async () => {
    const response = {
      ok: true,
      status: 200,
      json: async () => Promise.reject(new SyntaxError('x')),
    };
    const { client } = harness([response as unknown as Response]);
    expect((await client.weeklySummary(context)).result).toEqual({ kind: 'protocol_error' });
  });

  it.each([[{ kind: 'teapot' }], [{ hello: 'world' }], [null], ['text']])(
    'is a protocol error when the body is %j',
    async (body) => {
      const { client } = harness([reply(body)]);
      expect((await client.weeklySummary(context)).result).toEqual({ kind: 'protocol_error' });
    },
  );

  it('is a protocol error when an ok answer carries a summary that breaks the schema', async () => {
    const { client } = harness([reply({ ...OK, summary: { headline: '' } })]);
    expect((await client.weeklySummary(context)).result).toEqual({ kind: 'protocol_error' });
  });
});

describe('time and cancellation', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** A fetch that never answers and fails when it is told to stop. */
  const hanging = () => {
    const calls: number[] = [];
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        calls.push(1);
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    return { fetchImpl, calls };
  };

  it('gives up after the client timeout', async () => {
    const { fetchImpl, calls } = hanging();
    const client = createCoachClient(config, {
      newRequestId: () => 'req-0001-abcdef',
      fetch: fetchImpl,
    });
    const pending = client.weeklySummary(context);

    await jest.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 1);
    expect((await pending).result).toEqual({ kind: 'client_timeout' });
    expect(calls).toHaveLength(1);
  });

  it('honours a shorter timeout', async () => {
    const { fetchImpl } = hanging();
    const client = createCoachClient(config, {
      newRequestId: () => 'req-0001-abcdef',
      fetch: fetchImpl,
    });
    const pending = client.weeklySummary(context, { timeoutMs: 100 });

    await jest.advanceTimersByTimeAsync(101);
    expect((await pending).result).toEqual({ kind: 'client_timeout' });
  });

  it('is cancelled by the caller, and the request is told to stop', async () => {
    const { fetchImpl } = hanging();
    const client = createCoachClient(config, {
      newRequestId: () => 'req-0001-abcdef',
      fetch: fetchImpl,
    });
    const controller = new AbortController();
    const pending = client.weeklySummary(context, { signal: controller.signal });

    controller.abort();
    expect((await pending).result).toEqual({ kind: 'aborted' });
  });

  it('does not open a connection for a call that was cancelled before it began', async () => {
    const { fetchImpl, calls } = hanging();
    const client = createCoachClient(config, {
      newRequestId: () => 'req-0001-abcdef',
      fetch: fetchImpl,
    });
    const controller = new AbortController();
    controller.abort();

    expect((await client.weeklySummary(context, { signal: controller.signal })).result).toEqual({
      kind: 'aborted',
    });
    expect(calls).toHaveLength(0);
  });

  it('uses the real clock, timers and global fetch when given no overrides', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => reply(UPSTREAM, 502)) as unknown as typeof fetch;
    try {
      const client = createCoachClient(config, { newRequestId: () => 'req-0001-abcdef' });
      const pending = client.weeklySummary(context);
      await jest.advanceTimersByTimeAsync(5000);
      const outcome = await pending;
      expect(outcome.attempts).toBe(MAX_RETRIES + 1);
      expect(outcome.result).toEqual(UPSTREAM);
    } finally {
      globalThis.fetch = original;
    }
  });
});
