import type { LanguageModel } from 'ai';

import type { ApiError } from '../../src/ai/contract/api';
import { CONTRACT_VERSION } from '../../src/ai/contract/versions';
import { dailyBudget, type DailyBudget } from './budget';
import type { Env } from './env';

/** A request is a few thousand tokens of JSON; anything near this is not one. */
export const MAX_BODY_BYTES = 64 * 1024;
/** The summary's own limit; the client gives up well after it. A hung provider cannot hold a call forever. */
export const GENERATION_TIMEOUT_MS = 25_000;
/** A chat step streams, so it is allowed longer; the person can cancel any time before. */
export const CHAT_TIMEOUT_MS = 45_000;

export const STATUS: Record<ApiError['kind'], number> = {
  unauthorized: 401,
  not_found: 404,
  payload_too_large: 413,
  bad_request: 400,
  contract_mismatch: 409,
  rate_limited: 429,
  budget_exhausted: 429,
  invalid_output: 422,
  upstream_error: 502,
  timeout: 504,
  misconfigured: 500,
};

export interface Deps {
  model: (env: Env) => LanguageModel | null;
  now: () => Date;
  timeoutMs: number;
  chatTimeoutMs: number;
}

export function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function positiveInt(raw: string | undefined): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** What the caller wants logged about a request whatever happens to it. */
export interface Tracked {
  requestId: string | null;
  modelId: string | null;
}

export interface Admitted<T> {
  data: T;
  model: LanguageModel;
  maxOutputTokens: number;
  budget: DailyBudget;
  /** Size of the request body, for a call that ends before the provider reports what it cost. */
  bodyBytes: number;
}

interface Schema<T> {
  safeParse(
    raw: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: unknown[] } };
}

/**
 * Everything that happens between "this is a call from the app" and "spend
 * tokens on it", the same for every endpoint: rate limit, body size, JSON,
 * contract version, the request schema, configuration, today's budget.
 *
 * It never reaches the provider. A refusal comes back as the `reject`
 * response the caller built (which also logs it); success hands over the
 * parsed request, the model and the budget to charge afterwards.
 */
export async function admit<T extends { requestId: string }>(args: {
  request: Request;
  env: Env;
  deps: Pick<Deps, 'model' | 'now'>;
  limiter: RateLimit;
  schema: Schema<T>;
  track: Tracked;
  modelIdOf: (model: LanguageModel) => string;
  reject: (error: ApiError, headers?: Record<string, string>) => Response;
}): Promise<{ ok: true; admitted: Admitted<T> } | { ok: false; response: Response }> {
  const { request, env, deps, track, reject } = args;
  const refuse = (error: ApiError, headers?: Record<string, string>) => ({
    ok: false as const,
    response: reject(error, headers),
  });

  const { success: underLimit } = await args.limiter.limit({ key: 'app' });
  if (!underLimit) return refuse({ kind: 'rate_limited' }, { 'retry-after': '60' });

  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    return refuse({ kind: 'payload_too_large' });
  }
  const text = await request.text();
  const bodyBytes = new TextEncoder().encode(text).length;
  if (bodyBytes > MAX_BODY_BYTES) {
    return refuse({ kind: 'payload_too_large' });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse({ kind: 'bad_request', issues: 1 });
  }

  // Checked before the full schema: a peer on another version should hear
  // "update the app", not a list of Zod issues about fields it never had.
  const version =
    isRecord(raw) && Number.isInteger(raw.contractVersion) ? raw.contractVersion : null;
  if (version !== CONTRACT_VERSION) {
    return refuse({
      kind: 'contract_mismatch',
      expected: CONTRACT_VERSION,
      got: typeof version === 'number' ? version : null,
    });
  }
  const parsed = args.schema.safeParse(raw);
  if (!parsed.success) return refuse({ kind: 'bad_request', issues: parsed.error.issues.length });
  track.requestId = parsed.data.requestId;

  const budgetLimit = positiveInt(env.DAILY_TOKEN_BUDGET);
  const maxOutputTokens = positiveInt(env.MAX_OUTPUT_TOKENS);
  const model = deps.model(env);
  if (budgetLimit === null || maxOutputTokens === null || model === null) {
    return refuse({ kind: 'misconfigured' });
  }
  track.modelId = args.modelIdOf(model);

  const budget = dailyBudget(env.BUDGET, budgetLimit, deps.now());
  if (!(await budget.hasRoom())) return refuse({ kind: 'budget_exhausted' });

  return { ok: true, admitted: { data: parsed.data, model, maxOutputTokens, budget, bodyBytes } };
}
