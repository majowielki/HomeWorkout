import {
  createPacer,
  DEFAULT_RPM,
  pacedModel,
  QUOTA_RETRIES,
  describeError,
  retryWaitMs,
  quotaWaitMs,
  rpmFromEnv,
  type Clock,
} from '../responders/pace';

/** A clock that only moves when something sleeps. */
function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  const clock: Clock = {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  };
  return { clock, sleeps, advance: (ms: number) => (t += ms) };
}

describe('pacing a live run', () => {
  it('reads the rate from the environment, 12 a minute by default', () => {
    expect(rpmFromEnv(undefined)).toBe(DEFAULT_RPM);
    expect(rpmFromEnv('abc')).toBe(DEFAULT_RPM);
    expect(rpmFromEnv('0')).toBe(DEFAULT_RPM);
    expect(rpmFromEnv('60')).toBe(60);
  });

  it('spaces requests evenly, and does not wait when they are already apart', async () => {
    const { clock, sleeps, advance } = fakeClock();
    const pace = createPacer(12, clock);
    await pace();
    await pace();
    await pace();
    expect(sleeps).toEqual([5000, 5000]);
    advance(20_000);
    await pace();
    expect(sleeps).toHaveLength(2);
  });

  it('recognises a quota refusal and how long it asks to wait', () => {
    expect(quotaWaitMs({ statusCode: 429, message: 'Please retry in 45.6s.' })).toBe(46_600);
    expect(quotaWaitMs({ message: 'You exceeded your current quota' })).toBe(60_000);
    expect(quotaWaitMs({ statusCode: 500, message: 'boom' })).toBeNull();
    expect(quotaWaitMs('quota')).toBeNull();
    expect(quotaWaitMs(null)).toBeNull();
  });
});

describe('pacedModel', () => {
  class Model {
    readonly modelId = 'm';
    #calls = 0;
    get calls() {
      return this.#calls;
    }
    constructor(private readonly failures: unknown[] = []) {}
    async doGenerate(options: { prompt: string }) {
      this.#calls += 1;
      const failure = this.failures.shift();
      if (failure) throw failure;
      return `answer to ${options.prompt}`;
    }
    async doStream() {
      return 'stream';
    }
  }

  it('paces both kinds of call and leaves everything else as it was', async () => {
    const { clock, sleeps } = fakeClock();
    const model = new Model();
    const paced = pacedModel(model, { rpm: 30, clock });
    expect(await paced.doGenerate({ prompt: 'a' })).toBe('answer to a');
    expect(await paced.doStream()).toBe('stream');
    expect(paced.modelId).toBe('m');
    expect(paced.calls).toBe(1);
    expect(sleeps).toEqual([2000]);
  });

  it('waits out a quota refusal and tries again', async () => {
    const { clock, sleeps } = fakeClock();
    const log = jest.fn();
    const model = new Model([{ statusCode: 429, message: 'Please retry in 3s.' }]);
    const paced = pacedModel(model, { rpm: 60, clock, log });
    expect(await paced.doGenerate({ prompt: 'b' })).toBe('answer to b');
    expect(model.calls).toBe(2);
    expect(sleeps).toContain(4000);
    expect(log).toHaveBeenCalledWith('provider refused (429: Please retry in 3s.): waiting 4 s');
  });

  it('gives up after a few refusals, and never retries another error', async () => {
    const { clock } = fakeClock();
    const quota = { statusCode: 429, message: 'quota' };
    const stubborn = new Model(Array.from({ length: QUOTA_RETRIES + 1 }, () => quota));
    await expect(pacedModel(stubborn, { rpm: 60, clock }).doGenerate({ prompt: 'c' })).rejects.toBe(
      quota,
    );
    expect(stubborn.calls).toBe(QUOTA_RETRIES + 1);

    const broken = new Model([new Error('bad request')]);
    await expect(
      pacedModel(broken, { rpm: 60, clock }).doGenerate({ prompt: 'd' }),
    ).rejects.toThrow('bad request');
    expect(broken.calls).toBe(1);
  });
});

describe('transient errors and the per-attempt limit', () => {
  it('retries a provider error marked retryable, briefly, and nothing else', () => {
    expect(retryWaitMs({ statusCode: 503, isRetryable: true }, 0)).toBe(2000);
    expect(retryWaitMs({ statusCode: 503, isRetryable: true }, 1)).toBe(4000);
    expect(retryWaitMs({ statusCode: 400, isRetryable: false }, 0)).toBeNull();
    expect(retryWaitMs(new Error('x'), 0)).toBeNull();
  });

  it('starts the production limit after the pacing wait, for each attempt', async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const model = {
      async doGenerate(options: { abortSignal?: AbortSignal }) {
        seen.push(options.abortSignal);
        return 'ok';
      },
    };
    const { clock } = fakeClock();
    const outer = new AbortController();
    const paced = pacedModel(model, { rpm: 60, clock, attemptTimeoutMs: 8000 });
    await paced.doGenerate({ abortSignal: outer.signal });
    await pacedModel(model, { rpm: 60, clock }).doGenerate({});
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[0]).not.toBe(outer.signal);
    outer.abort();
    expect(seen[0]!.aborted).toBe(true);
    expect(seen[1]).toBeUndefined();
  });

  it('describes an error by class, status and first line, and nothing for a key to hide in', () => {
    const error = Object.assign(new Error('overloaded\nbody: {"key": "AQ.secret"}'), {
      name: 'AI_APICallError',
      statusCode: 503,
    });
    expect(describeError(error)).toBe('AI_APICallError 503: overloaded');
    expect(describeError('plain')).toBe('plain');
    expect(describeError({})).toBe('unknown error');
  });
});
