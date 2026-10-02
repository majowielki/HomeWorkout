import { type ChatEvent, type ChatRequest } from '../../contract/chat';
import { CONTRACT_VERSION } from '../../contract/versions';
import { createChatStreamer, MAX_LINE_BYTES, type StreamEnd } from '../chatClient';
import { MAX_RETRIES } from '../coachClient';

const config = { baseUrl: 'https://coach.test', secret: 's3cret' };

const request: ChatRequest = {
  contractVersion: CONTRACT_VERSION,
  requestId: 'req-chat-0001',
  facts: {
    asOf: '2026-10-01',
    historicalSessionCount: 12,
    signals: [],
    constraints: [],
  },
  messages: [{ role: 'user', text: 'Jak idzie wiosłowanie?' }],
};

const bytes = (text: string) => new TextEncoder().encode(text);
const line = (event: ChatEvent) => bytes(`${JSON.stringify(event)}\n`);

const START: ChatEvent = {
  type: 'start',
  requestId: 'req-chat-0001',
  promptVersion: 'chat/v1',
  model: 'm',
};
const text = (delta: string): ChatEvent => ({ type: 'text', delta });
const FINISH: ChatEvent = {
  type: 'finish',
  reason: 'stop',
  usage: { inputTokens: 100, outputTokens: 10 },
};
const UPSTREAM: ChatEvent = { type: 'error', error: { kind: 'upstream_error', retryable: true } };

type Piece = Uint8Array | Error | 'hang';

/** Just enough of a Response: headers, a JSON body, and a reader that serves the pieces in order. */
function streamed(pieces: Piece[], signal?: AbortSignal, status = 200): Response {
  let next = 0;
  return {
    ok: status < 400,
    status,
    headers: {
      get: (name: string) =>
        name === 'content-type' ? 'application/x-ndjson; charset=utf-8' : null,
    },
    body: {
      getReader: () => ({
        read: async () => {
          const piece = pieces[next];
          next += 1;
          if (piece === undefined) return { done: true, value: undefined };
          if (piece instanceof Error) throw piece;
          if (piece === 'hang') {
            return new Promise((_, reject) =>
              signal?.addEventListener('abort', () => reject(new Error('aborted'))),
            );
          }
          return { done: false, value: piece };
        },
      }),
    },
  } as unknown as Response;
}

const failure = (body: unknown, status: number, contentType = 'application/json') =>
  ({
    ok: false,
    status,
    headers: { get: () => contentType },
    json: async () => body,
  }) as unknown as Response;

type Scripted =
  Response | Error | ((signal: AbortSignal | undefined) => Response | Promise<Response>);

function harness(responses: Scripted[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  let i = 0;
  const streamer = createChatStreamer(config, {
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = responses[Math.min(i, responses.length - 1)]!;
      i += 1;
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next(init.signal ?? undefined) : next;
    }) as unknown as typeof fetch,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
  });
  const events: ChatEvent[] = [];
  const run = (
    options: { signal?: AbortSignal; idleTimeoutMs?: number } = {},
  ): Promise<StreamEnd> => streamer.stream(request, { ...options, onEvent: (e) => events.push(e) });
  return { run, calls, sleeps, events };
}

describe('the request', () => {
  it('posts the conversation with the shared secret, asking for NDJSON', async () => {
    const { run, calls } = harness([streamed([line(START), line(FINISH)])]);
    await run();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://coach.test/v1/chat');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers).toEqual({
      'content-type': 'application/json',
      accept: 'application/x-ndjson',
      'x-app-secret': 's3cret',
    });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(request);
  });

  it('refuses to send a conversation the contract does not allow', async () => {
    const { calls } = harness([streamed([])]);
    const streamer = createChatStreamer(config, { fetch: (async () => streamed([])) as never });
    await expect(
      streamer.stream({ ...request, messages: [] }, { onEvent: () => {} }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('a streamed answer', () => {
  it('hands over every event in order and ends complete at the finish', async () => {
    const { run, events } = harness([
      streamed([line(START), line(text('Trzy ')), line(text('sesje.')), line(FINISH)]),
    ]);
    expect(await run()).toEqual({ kind: 'complete' });
    expect(events).toEqual([START, text('Trzy '), text('sesje.'), FINISH]);
  });

  it('hands over a text event the moment it is complete, before the rest has arrived', async () => {
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const response = {
      ok: true,
      status: 200,
      headers: { get: () => 'application/x-ndjson' },
      body: {
        getReader: () => {
          let step = 0;
          return {
            read: async () => {
              step += 1;
              if (step === 1) return { done: false, value: line(text('Pierwsze')) };
              if (step === 2) {
                await gate;
                return { done: false, value: line(FINISH) };
              }
              return { done: true, value: undefined };
            },
          };
        },
      },
    } as unknown as Response;
    const streamer = createChatStreamer(config, { fetch: (async () => response) as never });
    const ended = streamer.stream(request, {
      onEvent: (e) => {
        if (e.type === 'text') seen.push(e.delta);
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(seen).toEqual(['Pierwsze']); // while the finish is still being held back
    release();
    expect(await ended).toEqual({ kind: 'complete' });
  });

  it('puts an event back together when it arrives in pieces, Polish letters included', async () => {
    const whole = line(text('Żółć i ąę'));
    const cut = whole.indexOf(0xc5) + 1; // inside the first two-byte letter
    const { run, events } = harness([
      streamed([whole.slice(0, cut), whole.slice(cut), line(FINISH)]),
    ]);
    await run();
    expect(events).toEqual([text('Żółć i ąę'), FINISH]);
  });

  it('delivers several events that arrive in one chunk', async () => {
    const merged = new Uint8Array([...line(text('a')), ...line(text('b')), ...line(FINISH)]);
    const { run, events } = harness([streamed([merged])]);
    await run();
    expect(events).toEqual([text('a'), text('b'), FINISH]);
  });

  it('stops reading at the finish', async () => {
    const { run, events } = harness([streamed([line(FINISH), line(text('late'))])]);
    await run();
    expect(events).toEqual([FINISH]);
  });
});

describe('failures the Worker reports', () => {
  it.each([
    [{ kind: 'unauthorized' }, 401],
    [{ kind: 'rate_limited' }, 429],
    [{ kind: 'budget_exhausted' }, 429],
    [{ kind: 'contract_mismatch', expected: 1, got: 2 }, 409],
    [{ kind: 'timeout' }, 504],
    [{ kind: 'misconfigured' }, 500],
  ])('before the stream: %j', async (body, status) => {
    const { run, events } = harness([failure(body, status)]);
    expect(await run()).toEqual({ kind: 'failed', failure: body });
    expect(events).toEqual([]);
  });

  it('inside the stream, after text was already shown: ends failed, text already delivered', async () => {
    const { run, events } = harness([
      streamed([line(START), line(text('Zaczynam')), line(UPSTREAM)]),
    ]);
    expect(await run()).toEqual({
      kind: 'failed',
      failure: { kind: 'upstream_error', retryable: true },
    });
    expect(events.map((e) => e.type)).toEqual(['start', 'text', 'error']);
  });

  it('as something it cannot read: an answer that is not an error either', async () => {
    const { run } = harness([failure({ kind: 'surprise' }, 500)]);
    expect(await run()).toEqual({ kind: 'failed', failure: { kind: 'protocol_error' } });
  });

  it('as a body that is not JSON at all', async () => {
    const broken = {
      ok: false,
      status: 502,
      headers: { get: () => 'text/html' },
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    } as unknown as Response;
    expect(await harness([broken]).run()).toEqual({
      kind: 'failed',
      failure: { kind: 'protocol_error' },
    });
  });
});

describe('an answer this version does not understand', () => {
  const protocolError = { kind: 'failed', failure: { kind: 'protocol_error' } };

  it('a line that is not JSON', async () => {
    expect(await harness([streamed([bytes('not json\n')])]).run()).toEqual(protocolError);
  });

  it('an event the contract does not have', async () => {
    const odd = bytes('{"type":"thinking","text":"x"}\n');
    expect(await harness([streamed([odd])]).run()).toEqual(protocolError);
  });

  it('an event that carries a field nobody listed', async () => {
    const odd = bytes('{"type":"text","delta":"x","debug":true}\n');
    expect(await harness([streamed([odd])]).run()).toEqual(protocolError);
  });

  it('a body that is not a stream', async () => {
    const noBody = {
      ok: true,
      status: 200,
      headers: { get: () => 'application/x-ndjson' },
      body: null,
    } as unknown as Response;
    expect(await harness([noBody]).run()).toEqual(protocolError);
  });

  it('a 200 that is not NDJSON', async () => {
    expect(await harness([failure({ ok: true }, 200)]).run()).toEqual(protocolError);
  });

  it('a line that never ends', async () => {
    const huge = new Uint8Array(MAX_LINE_BYTES + 1).fill(0x78);
    expect(await harness([streamed([huge])]).run()).toEqual(protocolError);
  });
});

describe('a connection that does not hold', () => {
  it('no network at all', async () => {
    expect(await harness([new TypeError('Network request failed')]).run()).toEqual({
      kind: 'failed',
      failure: { kind: 'offline' },
    });
  });

  it('dropping in the middle of the answer', async () => {
    const { run, events } = harness([
      streamed([line(text('Zaczynam')), new Error('connection reset')]),
    ]);
    expect(await run()).toEqual({ kind: 'failed', failure: { kind: 'offline' } });
    expect(events).toEqual([text('Zaczynam')]);
  });

  it('closing cleanly before the answer said it was finished', async () => {
    const { run } = harness([streamed([line(START), line(text('Urwane'))])]);
    expect(await run()).toEqual({ kind: 'failed', failure: { kind: 'offline' } });
  });

  it('going quiet for longer than allowed, and hanging up', async () => {
    let signal: AbortSignal | undefined;
    const { run } = harness([
      (s) => {
        signal = s;
        return streamed([line(START), 'hang'], s);
      },
    ]);
    expect(await run({ idleTimeoutMs: 20 })).toEqual({
      kind: 'failed',
      failure: { kind: 'client_timeout' },
    });
    expect(signal?.aborted).toBe(true);
  });

  it('not counting a slow but steady answer as silence', async () => {
    const pieces: Piece[] = [line(START), line(text('a')), line(text('b')), line(FINISH)];
    const slow = {
      ok: true,
      status: 200,
      headers: { get: () => 'application/x-ndjson' },
      body: {
        getReader: () => {
          let i = 0;
          return {
            read: async () => {
              await new Promise((resolve) => setTimeout(resolve, 15));
              const piece = pieces[i++] as Uint8Array | undefined;
              return piece ? { done: false, value: piece } : { done: true, value: undefined };
            },
          };
        },
      },
    } as unknown as Response;
    const streamer = createChatStreamer(config, { fetch: (async () => slow) as never });
    const end = await streamer.stream(request, { idleTimeoutMs: 40, onEvent: () => {} });
    expect(end).toEqual({ kind: 'complete' });
  });
});

describe('without overrides', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('uses the real clock, timers and global fetch', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      failure({ kind: 'upstream_error', retryable: true }, 502)) as unknown as typeof fetch;
    try {
      const pending = createChatStreamer(config).stream(request, { onEvent: () => {} });
      await jest.advanceTimersByTimeAsync(5000);
      expect(await pending).toEqual({
        kind: 'failed',
        failure: { kind: 'upstream_error', retryable: true },
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('cancelling', () => {
  it('does not even open a connection when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { run, calls } = harness([streamed([line(FINISH)])]);
    expect(await run({ signal: controller.signal })).toEqual({
      kind: 'failed',
      failure: { kind: 'aborted' },
    });
    expect(calls).toHaveLength(0);
  });

  it('closes the connection, and says aborted rather than offline, when cancelled mid-stream', async () => {
    const controller = new AbortController();
    let connection: AbortSignal | undefined;
    const { run, events } = harness([
      (s) => {
        connection = s;
        return streamed([line(text('Zaczynam')), 'hang'], s);
      },
    ]);
    const ended = run({ signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    expect(await ended).toEqual({ kind: 'failed', failure: { kind: 'aborted' } });
    expect(connection?.aborted).toBe(true);
    expect(events).toEqual([text('Zaczynam')]);
  });
});

describe('retrying', () => {
  const upstream = () => failure({ kind: 'upstream_error', retryable: true }, 502);
  const success = () => streamed([line(START), line(text('ok')), line(FINISH)]);

  it('repeats a retryable failure that came before anything arrived, with a growing pause', async () => {
    const { run, calls, sleeps } = harness([upstream(), upstream(), success()]);
    expect(await run()).toEqual({ kind: 'complete' });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('gives up after the allowed number of retries', async () => {
    const { run, calls } = harness([upstream()]);
    expect(await run()).toEqual({
      kind: 'failed',
      failure: { kind: 'upstream_error', retryable: true },
    });
    expect(calls).toHaveLength(MAX_RETRIES + 1);
  });

  it('does not repeat what the Worker said is not worth repeating', async () => {
    const { run, calls } = harness([failure({ kind: 'upstream_error', retryable: false }, 502)]);
    await run();
    expect(calls).toHaveLength(1);
  });

  it('does not repeat any other kind of failure', async () => {
    const { run, calls } = harness([failure({ kind: 'rate_limited' }, 429)]);
    await run();
    expect(calls).toHaveLength(1);
  });

  it('does not repeat once text or a tool call has reached the person', async () => {
    const { run, calls } = harness([
      streamed([line(START), line(text('Zaczynam')), line(UPSTREAM)]),
    ]);
    await run();
    expect(calls).toHaveLength(1);
  });

  it('does repeat when only the start had arrived: nothing visible would be doubled', async () => {
    const { run, calls } = harness([streamed([line(START), line(UPSTREAM)]), success()]);
    expect(await run()).toEqual({ kind: 'complete' });
    expect(calls).toHaveLength(2);
  });

  it('does not repeat a call that was cancelled', async () => {
    const controller = new AbortController();
    const { run, calls } = harness([
      () => {
        controller.abort();
        throw new Error('aborted');
      },
    ]);
    expect(await run({ signal: controller.signal })).toEqual({
      kind: 'failed',
      failure: { kind: 'aborted' },
    });
    expect(calls).toHaveLength(1);
  });

  it('stops repeating when cancelled during the pause', async () => {
    const controller = new AbortController();
    const calls: number[] = [];
    const streamer = createChatStreamer(config, {
      fetch: (async () => {
        calls.push(1);
        return upstream();
      }) as never,
      sleep: async () => controller.abort(),
      random: () => 0.5,
    });
    const end = await streamer.stream(request, { signal: controller.signal, onEvent: () => {} });
    expect(calls).toHaveLength(1);
    // The next attempt sees the cancellation before it opens a connection.
    expect(end).toEqual({ kind: 'failed', failure: { kind: 'aborted' } });
  });
});
