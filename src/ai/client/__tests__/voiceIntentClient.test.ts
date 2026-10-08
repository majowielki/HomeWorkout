import { CONTRACT_VERSION } from '../../contract/versions';
import { createVoiceIntentClient, VOICE_CLIENT_TIMEOUT_MS } from '../voiceIntentClient';

const config = { baseUrl: 'https://coach.test', secret: 's3cret' };
const input = {
  transcript: 'lecimy dalej',
  alternatives: [],
  available: ['rest_end' as const, 'skip_exercise' as const],
};
const OK = {
  kind: 'ok',
  requestId: 'req-voice-0001',
  promptVersion: 'voice-intent/v1',
  model: 'm',
  usage: { inputTokens: 300, outputTokens: 4 },
  action: 'rest_end',
  validationOutcome: 'ok',
};

const reply = (body: unknown) => ({ json: async () => body }) as unknown as Response;

function harness(respond: (init: RequestInit) => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  let clock = 1000;
  const call = createVoiceIntentClient(config, {
    newRequestId: () => 'req-voice-0001',
    now: () => (clock += 50),
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(init);
    }) as unknown as typeof fetch,
  });
  return { call, calls };
}

it('posts the request once, with the secret, and returns the parsed answer', async () => {
  const { call, calls } = harness(async () => reply(OK));
  const outcome = await call(input);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe('https://coach.test/v1/voice-intent');
  expect(calls[0]!.init.headers).toMatchObject({ 'x-app-secret': 's3cret' });
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
    contractVersion: CONTRACT_VERSION,
    requestId: 'req-voice-0001',
    ...input,
  });
  expect(outcome).toEqual({ requestId: 'req-voice-0001', result: OK, latencyMs: 50 });
});

it('does not retry a failure, and passes the Worker’s typed error on', async () => {
  const { call, calls } = harness(async () => reply({ kind: 'upstream_error', retryable: true }));
  expect((await call(input)).result).toEqual({ kind: 'upstream_error', retryable: true });
  expect(calls).toHaveLength(1);
});

it('an answer it cannot read is a protocol error', async () => {
  const { call } = harness(async () => reply({ kind: 'ok', action: 'dance' }));
  expect((await call(input)).result).toEqual({ kind: 'protocol_error' });
  const broken = harness(
    async () => ({ json: async () => Promise.reject(new Error('x')) }) as never,
  );
  expect((await broken.call(input)).result).toEqual({ kind: 'protocol_error' });
});

it('no network is offline', async () => {
  const { call } = harness(async () => Promise.reject(new TypeError('Network request failed')));
  expect((await call(input)).result).toEqual({ kind: 'offline' });
});

/** A fetch that never answers until its signal aborts. */
const hanging = (init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

it('gives up after its own limit', async () => {
  jest.useFakeTimers();
  try {
    const { call } = harness(hanging);
    const pending = call(input);
    jest.advanceTimersByTime(VOICE_CLIENT_TIMEOUT_MS);
    expect((await pending).result).toEqual({ kind: 'client_timeout' });
  } finally {
    jest.useRealTimers();
  }
});

it('a cancel is not an error, before or during the call', async () => {
  const before = new AbortController();
  before.abort();
  const idle = harness(async () => reply(OK));
  expect((await idle.call(input, { signal: before.signal })).result).toEqual({ kind: 'aborted' });
  expect(idle.calls).toHaveLength(0);

  const during = new AbortController();
  const { call } = harness(hanging);
  const pending = call(input, { signal: during.signal });
  during.abort();
  expect((await pending).result).toEqual({ kind: 'aborted' });
});
