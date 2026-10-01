import { APICallError, type LanguageModel } from 'ai';

import { CONTRACT_VERSION } from '../../src/ai/contract/versions';
import {
  type ApiError,
  weeklySummaryRequestSchema,
  type WeeklySummaryResponse,
} from '../../src/ai/contract/weeklySummary';
import { WEEKLY_SUMMARY_PROMPT_VERSION } from '../../src/ai/prompts/weeklySummary/v1';
import { isAuthorized } from './auth';
import { dailyBudget } from './budget';
import type { Env } from './env';
import { estimateCostUsd, logRecord, type Outcome } from './log';
import { modelFromEnv } from './model';
import { generateWeeklySummary, modelIdOf, type Tally } from './weeklySummary';

export type { Env } from './env';

/** A summary request is a few thousand tokens of JSON; anything near this is not one. */
export const MAX_BODY_BYTES = 64 * 1024;
/** The client gives up well before this; it exists so a hung provider cannot hold a call forever. */
export const GENERATION_TIMEOUT_MS = 25_000;

const STATUS: Record<ApiError['kind'], number> = {
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
}

function json(body: WeeklySummaryResponse, status: number, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function positiveInt(raw: string | undefined): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * The Worker, with its dependencies injectable. Tests pass a mock model and
 * a fixed clock; `src/dev.ts` passes a fake model so the app can be run end
 * to end without a provider key; production uses the defaults.
 */
export function createHandler(overrides: Partial<Deps> = {}): ExportedHandler<Env> {
  const deps: Deps = {
    model: modelFromEnv,
    now: () => new Date(),
    timeoutMs: GENERATION_TIMEOUT_MS,
    ...overrides,
  };

  return {
    async fetch(request, env): Promise<Response> {
      const started = Date.now();
      let requestId: string | null = null;
      let promptVersion: string | null = null;
      let modelId: string | null = null;
      let attempts = 0;
      const tally: Tally = { inputTokens: 0, outputTokens: 0 };

      /** Every answer after authentication is logged here, once, as metadata. */
      function finish(response: Response, outcome: Outcome): Response {
        logRecord({
          event: 'weekly_summary',
          requestId,
          contractVersion: CONTRACT_VERSION,
          promptVersion,
          provider: env.PROVIDER,
          model: modelId,
          tokensIn: tally.inputTokens,
          tokensOut: tally.outputTokens,
          latencyMs: Date.now() - started,
          attempts,
          outcome,
          status: response.status,
          estimatedCostUsd: estimateCostUsd(tally.inputTokens, tally.outputTokens, env),
        });
        return response;
      }
      const reject = (error: ApiError, headers?: Record<string, string>) =>
        finish(json(error, STATUS[error.kind], headers), 'rejected');

      const url = new URL(request.url);
      if (request.method !== 'POST' || url.pathname !== '/v1/weekly-summary') {
        return json({ kind: 'not_found' }, 404);
      }
      if (!isAuthorized(request, env.APP_SECRET)) return json({ kind: 'unauthorized' }, 401);

      const { success: underLimit } = await env.LIMITER.limit({ key: 'app' });
      if (!underLimit) return reject({ kind: 'rate_limited' }, { 'retry-after': '60' });

      // --- the request ---------------------------------------------------------
      if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
        return reject({ kind: 'payload_too_large' });
      }
      const text = await request.text();
      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
        return reject({ kind: 'payload_too_large' });
      }

      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return reject({ kind: 'bad_request', issues: 1 });
      }

      // Checked before the full schema: a peer on another version should hear
      // "update the app", not a list of Zod issues about fields it never had.
      const version =
        isRecord(raw) && Number.isInteger(raw.contractVersion) ? raw.contractVersion : null;
      if (version !== CONTRACT_VERSION) {
        return reject({
          kind: 'contract_mismatch',
          expected: CONTRACT_VERSION,
          got: typeof version === 'number' ? version : null,
        });
      }
      const parsed = weeklySummaryRequestSchema.safeParse(raw);
      if (!parsed.success)
        return reject({ kind: 'bad_request', issues: parsed.error.issues.length });
      requestId = parsed.data.requestId;

      // --- configuration, budget -----------------------------------------------
      const budgetLimit = positiveInt(env.DAILY_TOKEN_BUDGET);
      const maxOutputTokens = positiveInt(env.MAX_OUTPUT_TOKENS);
      const model = deps.model(env);
      if (budgetLimit === null || maxOutputTokens === null || model === null) {
        return reject({ kind: 'misconfigured' });
      }
      modelId = modelIdOf(model);

      const budget = dailyBudget(env.BUDGET, budgetLimit, deps.now());
      if (!(await budget.hasRoom())) return reject({ kind: 'budget_exhausted' });

      // --- the call --------------------------------------------------------------
      const timeout = AbortSignal.timeout(deps.timeoutMs);
      try {
        const generation = await generateWeeklySummary(model, parsed.data.context, {
          abortSignal: AbortSignal.any([request.signal, timeout]),
          maxOutputTokens,
          tally,
        });
        attempts = generation.attempts;
        promptVersion = WEEKLY_SUMMARY_PROMPT_VERSION;
        modelId = generation.modelId;
        const usage = { inputTokens: tally.inputTokens, outputTokens: tally.outputTokens };

        if (generation.kind === 'invalid_output') {
          return finish(
            json(
              {
                kind: 'invalid_output',
                requestId,
                promptVersion,
                attempts: generation.attempts,
                usage,
              },
              STATUS.invalid_output,
            ),
            'invalid_output',
          );
        }
        const repaired = generation.attempts > 1;
        return finish(
          json(
            {
              kind: 'ok',
              requestId,
              promptVersion,
              model: generation.modelId,
              usage,
              validationOutcome: repaired ? 'ok_after_repair' : 'ok',
              summary: generation.summary,
            },
            200,
          ),
          repaired ? 'ok_after_repair' : 'ok',
        );
      } catch (error) {
        if (request.signal.aborted) {
          // The app closed the connection (the person left the screen). Nobody is listening.
          return finish(new Response(null, { status: 499 }), 'aborted');
        }
        if (timeout.aborted) return finish(json({ kind: 'timeout' }, STATUS.timeout), 'timeout');
        const retryable = APICallError.isInstance(error) && error.isRetryable;
        return finish(
          json({ kind: 'upstream_error', retryable }, STATUS.upstream_error),
          'upstream_error',
        );
      } finally {
        // Tokens are spent whether or not the answer was usable.
        await budget.spend(tally.inputTokens + tally.outputTokens);
      }
    },
  } satisfies ExportedHandler<Env>;
}

export default createHandler();
