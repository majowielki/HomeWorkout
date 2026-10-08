# Coach Worker

A stateless Cloudflare Worker between the app and a language model. It holds
the provider key, applies a versioned prompt, validates the model's answer
twice (shape, then rules) and returns either a checked summary or a typed
error. It has no database and knows nothing about the person beyond the
request in front of it.

Why it looks like this: [ADR 0001](../docs/adr/0001-llm-does-not-compute-loads.md),
[ADR 0002](../docs/adr/0002-data-and-domain-stay-on-the-phone.md),
[ADR 0005](../docs/adr/0005-the-chat-loop-runs-on-the-phone-over-our-own-protocol.md) (the chat). The plan is
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

## The chat: `POST /v1/chat`

One model step of a conversation, streamed. The Worker holds no conversation:
the phone sends all of it with every request, runs the tools the model asks
for, and asks again ([ADR 0005](../docs/adr/0005-the-chat-loop-runs-on-the-phone-over-our-own-protocol.md)).

```
  1. route, authenticate   as above
  2. rate limit            its own binding, CHAT_LIMITER (30/min): one question is up to five requests
  3. read, validate        size, JSON, contractVersion, then the strict schema, which includes
                           the conversation grammar (a question, rounds of calls answered by results,
                           an optional reply) and each tool result against that tool's output schema
  4. text gate             every user message, with the same detectors the phone runs: a complaint,
                           or a question about diet or medication, is refused with 400 and the
                           provider is never called
  5. budget                as above
  6. stream                AI SDK streamText, tools declared WITHOUT execute (a call ends the step
                           and is handed back); toolChoice 'none' after the last allowed round
  7. respond               newline-delimited JSON, one event per line
```

| Event       | Carries                                                           |
| ----------- | ----------------------------------------------------------------- |
| `start`     | request id, prompt version, model                                 |
| `text`      | a piece of the answer                                             |
| `tool_call` | id, tool name, arguments: run it on the phone and ask again       |
| `finish`    | `stop`, `tool_calls`, `length` or `other`, and the tokens used    |
| `error`     | the same typed union as above, for a failure after the first byte |

A failure **before** the first provider event is an ordinary JSON error with a
status (502 `upstream_error`, 504 `timeout`, 422 `invalid_output` for a tool
that does not exist or arguments that do not parse). After that the status is
already 200 and the failure is an `error` event. A step may take 45 s.

**Cancelling.** When the client closes the connection the response stream is
cancelled, which aborts the provider call; the call is logged as `aborted`. A
call that ends before the provider reports usage is charged by estimate (a third
of the request's bytes in tokens), so a cancelled call is not free.

**What the log holds.** One line per call, as for the summary, with these added:
`toolRound` (rounds the question had used), `toolCalls`, `droppedCalls` (calls
beyond three in a round, ignored), `replyChars`, `finishReason`,
`guardViolations` (how many rules the reply broke, measured on the Worker and
enforced on the phone, which withdraws such a reply), `reasoningTokens` (of the
output tokens, how many were thinking), `firstEventMs` (how long until the
provider produced anything) and `reason: "text_gate"` for a refused message.
Both routes also log `upstreamStatus`, the HTTP status a provider refused with
(a number: 400 is usually a bad key or request, 404 an unknown model, 429 the
rate limit, 5xx the provider's own trouble). Never the text of a question, a
reply, a tool result or the provider's message. The SDK's own error logging is
switched off: a provider error can quote the request.

**Thinking.** Gemini 3 thinks before it answers, at `medium` by default, which
is many seconds per step, and its thinking tokens count against
`MAX_OUTPUT_TOKENS`. `THINKING_LEVEL` sets it per call; the shipped value is
`low`, a starting point that the evaluation should confirm or move.

The first live run (2026-10-02, `gemini-3.8-flash` at its default thinking
level) is what showed this: a two-step question took 20 s. It also showed that
Gemini accepts the tool declarations, asks for the tools and reads their results.
Still not run against a real provider: `toolChoice: 'none'` after the last
allowed round (no question has needed four rounds), and that a cancel closes the
provider's HTTP stream. Written to the SDK's documented behaviour, tested against
a mock model in workerd.

## The voice fallback: `POST /v1/voice-intent`

A spoken command the phone's word list did not understand, and the actions the
screen offers at that moment; one of those actions, or `unknown`, back
([`Documents/GLOS.md`](../Documents/GLOS.md), Polish). The phone has already
put the phrase through its text gate: a sentence about pain never gets here.

```
  1. route, authenticate   as above
  2. rate limit            CHAT_LIMITER, shared with the chat: both are short and interactive
  3. read, validate        size, JSON, contractVersion, then the schema: at most 120 characters of
                           heard text, up to three other guesses, 1-6 distinct known actions
  4. budget                as above
  5. generate              generateText + Output.object whose enum is built from the offered
                           actions plus "unknown", temperature 0, output capped at 512 tokens,
                           8 s limit, ONE attempt (the person is waiting mid-set)
  6. check                 an answer that does not parse, or names an action not offered,
                           becomes "unknown" with validationOutcome invalid_output
```

The answer carries an action name and nothing else. How many seconds "+N s" adds
is read from the phrase on the phone, so the model never writes a number. The
log line (`event: voice_intent`) has the same metadata as the other routes and
never the heard text.

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
| `MAX_OUTPUT_TOKENS`            | variable   | per call; thinking tokens count against it, so keep it generous   |
| `THINKING_LEVEL`               | variable   | `minimal`, `low`, `medium` or `high`; unset = the provider's own  |
| `PRICE_*_USD_PER_MTOK`         | variable   | optional, for the estimated cost in the log; otherwise `null`     |
| `BUDGET`                       | KV         | the day's token counter                                           |
| `LIMITER`                      | rate limit | summary requests per minute                                       |
| `CHAT_LIMITER`                 | rate limit | chat requests per minute (one question is several)                |

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

**Entering a secret.** `wrangler secret put` asks for the value in a hidden field,
and a pasted value can end up different from the one you meant (this happened on
the first deploy: a 401 from the Worker, then a provider that refused the key).
You cannot see the field, so you cannot tell. A value read from a file is exact;
in PowerShell:

```powershell
[IO.File]::WriteAllText("$env:TEMP\secret.txt", "<the value>")
cmd /c "npx wrangler secret put APP_SECRET < %TEMP%\secret.txt"
Remove-Item "$env:TEMP\secret.txt"
```

`npx wrangler secret list --name homeworkout-coach` shows which secrets exist, never
their values. If a call answers `unauthorized`, the app's secret and the Worker's
differ; if it answers `upstream_error` with `upstreamStatus` 400 or 403 in the log,
suspect the provider key.

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

`src/dev.ts` swaps in a fake model that returns a valid, obviously fake summary. For the chat it asks for one
tool on the first step, then streams a short answer a word at a time and logs `stream aborted by the Worker`
when a cancel reaches it, so the whole loop can be watched from the app. For the voice fallback it picks the
first offered action when the phrase contains "atrapa", and answers `unknown` otherwise.
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
src/voiceIntent.ts   one call: a phrase and the offered actions in, one of them or unknown out
src/voiceRoute.ts    POST /v1/voice-intent
src/model.ts         the only file that knows about a provider
src/auth.ts, budget.ts, log.ts, env.ts
src/dev.ts, fakeModel.ts      local only
../src/ai/contract   request / response schemas, shared with the app
../src/ai/prompts    versioned prompts, shared with the app's "copy prompt"
../src/domain/coach  the output guards, shared with the evaluation scorers
```
