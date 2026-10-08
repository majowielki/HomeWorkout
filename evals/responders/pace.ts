/**
 * Keeps a live run under the provider's per-minute limit. The free Gemini
 * tier allows 15 requests a minute; a run fires them one after another, so
 * without pacing every case after the fifteenth fails on quota and reads as
 * "no answer", which says nothing about the model.
 *
 * Applied to the model itself, so a weekly summary's repair round and every
 * step of a chat turn are paced too, not just the cases.
 */

/** Requests per minute a live run allows itself, unless EVAL_RPM says otherwise. */
export const DEFAULT_RPM = 12;
/** How often a call refused for quota is tried again before the case counts as failed. */
export const QUOTA_RETRIES = 3;
/** When the refusal does not say how long to wait. */
const FALLBACK_WAIT_MS = 60_000;

export interface Clock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const realClock: Clock = {
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function rpmFromEnv(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RPM;
}

/** Resolves when the next request may go: no closer than 60 s / rpm to the previous one. */
export function createPacer(rpm: number, clock: Clock = realClock) {
  const interval = 60_000 / rpm;
  let next = 0;
  return async function pace() {
    const wait = next - clock.now();
    next = Math.max(clock.now(), next) + interval;
    if (wait > 0) await clock.sleep(wait);
  };
}

/**
 * How long a quota refusal asks to wait, or null when the error is not one.
 * Gemini answers 429 with "Please retry in 45.6s." in the message.
 */
export function quotaWaitMs(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const { statusCode, message } = error as { statusCode?: unknown; message?: unknown };
  const text = typeof message === 'string' ? message : '';
  if (statusCode !== 429 && !/quota|rate limit/i.test(text)) return null;
  const seconds = /retry in ([\d.]+)\s*s/i.exec(text)?.[1];
  return seconds ? Math.ceil(Number(seconds) * 1000) + 1000 : FALLBACK_WAIT_MS;
}

/**
 * How long to wait before trying a failed call again, or null for an error
 * that another try will not fix. A quota refusal waits as long as it asks;
 * a provider's own transient trouble (a 5xx it marks retryable) a little.
 */
export function retryWaitMs(error: unknown, retry: number): number | null {
  const quota = quotaWaitMs(error);
  if (quota !== null) return quota;
  const retryable =
    typeof error === 'object' && error !== null && (error as { isRetryable?: unknown }).isRetryable;
  return retryable === true ? 2000 * (retry + 1) : null;
}

/**
 * The model with every request paced and a refusal waited out. A Proxy, so
 * the provider's object (its id, its URLs, its specification version) is
 * otherwise untouched.
 *
 * `attemptTimeoutMs` is the production limit for one call, started when the
 * request actually goes, after the pacing wait: a limit started before the
 * wait would let the pacing eat the model's time and read as a slow model.
 */
export function pacedModel<T extends object>(
  model: T,
  options: {
    rpm: number;
    clock?: Clock;
    /** A pace shared with other models; one of its own otherwise. */
    pace?: () => Promise<void>;
    attemptTimeoutMs?: number;
    log?: (line: string) => void;
  },
): T {
  const clock = options.clock ?? realClock;
  const pace = options.pace ?? createPacer(options.rpm, clock);
  return new Proxy(model, {
    get(target, prop) {
      // Read with the provider object itself as this: its getters may use private fields.
      const value: unknown = Reflect.get(target, prop);
      if ((prop !== 'doGenerate' && prop !== 'doStream') || typeof value !== 'function') {
        return value;
      }
      const call = value as (...a: unknown[]) => Promise<unknown>;
      return async (callOptions: { abortSignal?: AbortSignal }, ...rest: unknown[]) => {
        for (let retry = 0; ; retry += 1) {
          await pace();
          const signals = [
            callOptions?.abortSignal,
            options.attemptTimeoutMs ? AbortSignal.timeout(options.attemptTimeoutMs) : undefined,
          ].filter((x): x is AbortSignal => x !== undefined);
          const abortSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
          try {
            return await call.apply(target, [{ ...callOptions, abortSignal }, ...rest]);
          } catch (error) {
            const wait = retryWaitMs(error, retry);
            if (wait === null || retry >= QUOTA_RETRIES) throw error;
            options.log?.(
              `provider refused (${describeError(error)}): waiting ${Math.round(wait / 1000)} s`,
            );
            await clock.sleep(wait);
          }
        }
      };
    },
  });
}

/** A short, key-free description of a provider error, for the log and the report. */
export function describeError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error).slice(0, 200);
  const { name, statusCode, message } = error as {
    name?: unknown;
    statusCode?: unknown;
    message?: unknown;
  };
  const head = [
    typeof name === 'string' ? name : null,
    typeof statusCode === 'number' ? statusCode : null,
  ]
    .filter((x) => x !== null)
    .join(' ');
  const text = typeof message === 'string' ? message.split('\n')[0]!.slice(0, 160) : '';
  return [head, text].filter(Boolean).join(': ') || 'unknown error';
}

let shared: (<T extends object>(model: T, attemptTimeoutMs?: number) => T) | null = null;

/**
 * The live responders' entry point: one pace for the whole run, so a feature
 * starting right after another does not get a fresh allowance the provider
 * never gave. EVAL_RPM overrides the rate (a paid key allows far more).
 */
export function pacedFromEnv<T extends object>(model: T, attemptTimeoutMs?: number): T {
  if (!shared) {
    const rpm = rpmFromEnv(process.env.EVAL_RPM);
    const clock = realClock;
    const pace = createPacer(rpm, clock);
    shared = (m, timeout) =>
      pacedModel(m, {
        rpm,
        clock,
        pace,
        attemptTimeoutMs: timeout,
        log: (line) => process.stderr.write(`${line}\n`),
      });
  }
  return shared(model, attemptTimeoutMs);
}
