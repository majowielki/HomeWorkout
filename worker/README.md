# Coach Worker

A stateless Cloudflare Worker between the app and a language model. It holds
the provider key, applies a versioned prompt, validates the model's answer
twice (shape, then rules) and returns either a checked summary or a typed
error. It has no database and knows nothing about the person beyond the
request in front of it.

Why it looks like this: [ADR 0001](../docs/adr/0001-llm-does-not-compute-loads.md),
[ADR 0002](../docs/adr/0002-data-and-domain-stay-on-the-phone.md). The plan is
in [`Documents/AI-INTEGRACJA.md`](../Documents/AI-INTEGRACJA.md) (Polish).

## What it does for one call

```
POST /v1/weekly-summary
  1. route         anything else is 404
  2. authenticate  x-app-secret, compared in constant time; no secret configured = nobody gets in
  3. rate limit    Workers rate-limiting binding (6/min by default)
  4. read          body size capped at 64 KiB; JSON; contractVersion checked BEFORE the full schema
  5. validate      strict Zod schema shared with the app (src/ai/contract)
  6. budget        daily token fence in KV; over it, 429 without calling the model
  7. generate      AI SDK generateText + Output.object, temperature 0.2, no hidden SDK retries
  8. check         schema, then output guards (flags only from the signals, no trend words on
                   thin data, no diet/medication, no advice about a complaint)
  9. repair        one more attempt, told the reason but never shown its own text
 10. respond       ok | invalid_output | a typed error; every outcome after authentication
                   writes one metadata line to the log
```

Every answer is one of the shapes in `src/ai/contract/weeklySummary.ts`
(`weeklySummaryResponseSchema`), so the app maps `kind` onto a screen state
with an exhaustive `switch`.

| `kind`              | Status | Meaning                                                | Retry?         |
| ------------------- | ------ | ------------------------------------------------------ | -------------- |
| `ok`                | 200    | a checked summary                                      |                |
| `unauthorized`      | 401    | wrong or missing secret                                | no             |
| `not_found`         | 404    | wrong route or method                                  | no             |
| `payload_too_large` | 413    |                                                        | no             |
| `bad_request`       | 400    | not JSON, or a field the contract does not allow       | no             |
| `contract_mismatch` | 409    | app and Worker disagree on `contractVersion`           | no: update     |
| `rate_limited`      | 429    | `Retry-After: 60`                                      | after a minute |
| `budget_exhausted`  | 429    | today's tokens are spent                               | tomorrow       |
| `invalid_output`    | 422    | the model failed validation twice; nothing is returned | by hand        |
| `upstream_error`    | 502    | the provider failed; `retryable` says whether to retry | if `retryable` |
| `timeout`           | 504    | the provider took more than 25 s                       | by hand        |
| `misconfigured`     | 500    | a missing key, model id or budget                      | no             |

A client that closes the connection gets no answer (the Worker logs status 499
and the provider call is aborted).

## Configuration

Plain variables are in [`wrangler.jsonc`](wrangler.jsonc); secrets are set with
`wrangler secret put`.

| Name                           | Kind       | What for                                                          |
| ------------------------------ | ---------- | ----------------------------------------------------------------- |
| `APP_SECRET`                   | secret     | shared with the app; without it every request is refused          |
| `GOOGLE_GENERATIVE_AI_API_KEY` | secret     | the provider key; never leaves the Worker                         |
| `AI_GATEWAY_TOKEN`             | secret     | only if the AI Gateway is authenticated                           |
| `PROVIDER`                     | variable   | `google`                                                          |
| `MODEL_ID`                     | variable   | **no default**: choose from the provider's published list (D3)    |
| `AI_GATEWAY_BASE_URL`          | variable   | optional; routes through Cloudflare AI Gateway for logs and spend |
| `DAILY_TOKEN_BUDGET`           | variable   | input + output tokens per UTC day                                 |
| `MAX_OUTPUT_TOKENS`            | variable   | per call                                                          |
| `PRICE_*_USD_PER_MTOK`         | variable   | optional, for the estimated cost in the log; otherwise `null`     |
| `BUDGET`                       | KV         | the day's token counter                                           |
| `LIMITER`                      | rate limit | requests per minute                                               |

Through AI Gateway the Worker sends `cf-aig-collect-log-payload: false`, so the
gateway keeps token counts and latency but not what was said.

## First deploy

```bash
cd worker
npm ci
npx wrangler kv namespace create BUDGET          # paste the id into wrangler.jsonc
npx wrangler secret put APP_SECRET               # any long random string
npx wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY
# set MODEL_ID in wrangler.jsonc, then:
npx wrangler deploy
```

The free Gemini key does not train on data for a user in the EEA; a Worker that
other people will use must run on the paid plan (Terms of Service, "Paid
Services" for API clients offered to users in the EEA). See
`Documents/WERYFIKACJA-RESEARCH-AI.md` R3.

The app reads the URL and the shared secret from `EXPO_PUBLIC_COACH_URL` and
`EXPO_PUBLIC_COACH_SECRET` (a git-ignored `.env.local`). Anything embedded in an
app can be extracted from it; the threat model accepts that and bounds the damage
with the rate limit and the daily budget (AI-INTEGRACJA §4.7).

## Local development, no key needed

```bash
cd worker
echo "APP_SECRET=dev-secret" > .dev.vars     # git-ignored
npm run dev                                   # fake model, http://localhost:8787
```

`src/dev.ts` swaps in a fake model that returns a valid, obviously fake summary.
The deployed entry point (`src/index.ts`) does not import it.

## Tests

```bash
npm test            # Vitest 4.1 inside workerd, real KV, mock model
npm run typecheck   # generates the binding types, then tsc
npm run build:dry   # bundles as a deploy would, deploys nothing
```

No test calls a real model, and none needs a key. The model is a
`MockLanguageModelV4` from `ai/test`; the KV namespace is the real one, simulated
by Miniflare.

## Layout

```
src/index.ts         the handler (createHandler: model, clock and timeout are injectable)
src/weeklySummary.ts generate -> check -> repair loop
src/model.ts         the only file that knows about a provider
src/auth.ts, budget.ts, log.ts, env.ts
src/dev.ts, fakeModel.ts      local only
../src/ai/contract   request / response schemas, shared with the app
../src/ai/prompts    versioned prompts, shared with the app's "copy prompt"
../src/domain/coach  the output guards, shared with the evaluation scorers
```
