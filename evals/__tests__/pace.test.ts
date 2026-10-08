import {
  createPacer,
  DEFAULT_RPM,
  pacedModel,
  QUOTA_RETRIES,
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
    async doGenerate(input: string) {
      this.#calls += 1;
      const failure = this.failures.shift();
      if (failure) throw failure;
      return `answer to ${input}`;
    }
    async doStream() {
      return 'stream';
    }
  }

  it('paces both kinds of call and leaves everything else as it was', async () => {
    const { clock, sleeps } = fakeClock();
    const model = new Model();
    const paced = pacedModel(model, { rpm: 30, clock });
    expect(await paced.doGenerate('a')).toBe('answer to a');
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
    expect(await paced.doGenerate('b')).toBe('answer to b');
    expect(model.calls).toBe(2);
    expect(sleeps).toContain(4000);
    expect(log).toHaveBeenCalledWith('quota: waiting 4 s before trying again');
  });

  it('gives up after a few refusals, and never retries another error', async () => {
    const { clock } = fakeClock();
    const quota = { statusCode: 429, message: 'quota' };
    const stubborn = new Model(Array.from({ length: QUOTA_RETRIES + 1 }, () => quota));
    await expect(pacedModel(stubborn, { rpm: 60, clock }).doGenerate('c')).rejects.toBe(quota);
    expect(stubborn.calls).toBe(QUOTA_RETRIES + 1);

    const broken = new Model([new Error('bad request')]);
    await expect(pacedModel(broken, { rpm: 60, clock }).doGenerate('d')).rejects.toThrow(
      'bad request',
    );
    expect(broken.calls).toBe(1);
  });
});
