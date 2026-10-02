# 0005 — The chat loop runs on the phone, over a protocol of our own

- Status: accepted
- Date: 2026-10-02

## Context

The chat (F4) lets the person ask about their own training. The model does
not get a dump of the log; it gets read-only tools, and those tools run on
the phone, against the phone's database ([ADR 0002](0002-data-and-domain-stay-on-the-phone.md),
point 4). The Worker is stateless. The answer should stream, and leaving the
screen or pressing stop should reach the provider.

The plan left one decision open until now (D2): use the AI SDK's `useChat`
with `DefaultChatTransport` on the phone, or define the exchange ourselves.

## Decision

1. **The loop is ours, and it runs on the phone** (`src/ai/chat/runTurn.ts`).
   The phone asks the Worker for one model step. If the model wants tools,
   the phone runs them and asks again with the results in the conversation.
   The Worker answers one step per request and keeps nothing between them.
2. **The wire format is part of the shared contract** (`src/ai/contract/chat.ts`):
   a request is the whole conversation plus a few facts; an answer is
   newline-delimited JSON, one event per line (`start`, `text`, `tool_call`,
   `finish`, `error`). A failure before the first byte is an ordinary JSON
   error with a status code, the same union the weekly summary uses; after
   the first byte it is an `error` event.
3. **Tools are declared once, in the contract** (`src/ai/contract/chatTools.ts`):
   name, description, input schema, and a _strict_ output schema. The Worker
   declares them to the model from those definitions; the phone runs them and
   parses every result through its output schema before sending it, which is
   the same funnel that keeps `CoachContext` closed (I9). No tool output holds
   free text: exercise names come from the shipped catalogue.
4. **Limits are enforced on both sides.** At most four tool rounds per
   question and three calls per round. The Worker counts the rounds in the
   request it receives; after the last allowed round it keeps the tools
   declared but sets `toolChoice: 'none'`, so the model has to answer with
   what it has. The phone stops too, if a model asks again anyway.
5. **A conversation remembers questions and answers, not tool traffic.**
   Earlier turns are carried as question and answer only (the last six).
   Tool calls and results live for the question being answered: they are the
   bulk of the tokens, and they go stale.
6. **The text gate runs before anything is sent, and again at the Worker.**
   A message that reads as a complaint, or as a question about diet or
   medication, gets a fixed sentence from the app and sends nothing. The
   Worker applies the same detectors to every user message in a request, so
   the rule holds whoever the caller is.
7. **A reply is vetted after it has streamed, and withdrawn, not repaired.**
   The same word-level checks as the summary, plus "no load for a future
   session" (the summary's schema has no field for one; free text does not
   have that protection). A reply that breaks a rule is replaced on screen by
   the app's own sentence and is not remembered. The Worker runs the same
   check only to count violations in its log.
8. **Cancelling is a closed connection.** The client aborts its fetch; the
   Worker's response stream is cancelled; that aborts the provider call. A
   call that ended before the provider said what it cost is charged by
   estimate, so cancelling is not a way around the daily budget.

## Why not `useChat`

- **One contract.** Requests and events here are validated by the same Zod
  schemas on both sides, and a failure is the typed union the screens already
  switch over. With `useChat` the wire is the SDK's UI-message stream and its
  part types; the contract rule ("one schema, checked at both ends") would stop
  at the transport.
- **The checks sit between the steps.** The text gate, the tool output funnel,
  the round limits and the post-hoc guard are decisions the app makes around
  each step. Owning the loop makes them first-class and testable with an
  injected `fetch`, without rendering anything.
- **Less unverified on the device.** The research verification checked
  `useChat` against its types and docs only. `expo/fetch` streaming and abort
  were proven on the emulator; the SDK's React package was not, and it would
  bring the whole `ai` package into the app bundle.
- **`TextDecoder` is "not spec-compliant" on native** (Expo SDK 57 docs; UTF-8
  only). The client therefore splits the byte stream on the newline byte
  before decoding and never relies on a streaming decoder.

The cost is real: roughly three hundred lines of loop and client that
`useChat` would provide, and none of its extras (resumable streams, attachment
parts). If the chat grows what `useChat` already does, this is the decision to
revisit, not a reason to keep going.

## Consequences

- Every tool round resends the conversation and the instructions. At one user
  this is a few thousand tokens a question; provider-side caching of the stable
  prefix should soften it, and the daily budget bounds it.
- The text of a reply is visible while it streams, and withdrawn only when it
  ends. A reply that breaks a rule is on screen for as long as it takes to
  finish. Buffering until the end would remove that window and the point of
  streaming along with it.
- Not checked against a real provider: `toolChoice: 'none'` with calls in the
  history, tool declarations through Gemini's function-calling schema subset,
  and that cancelling closes the provider's HTTP stream. All three are written
  to the SDK's documented behaviour and tested against a mock model in
  workerd; none has been run live.
- `getPlanExplanation` is not a tool until the rules engine exists (M7). The
  chat says plainly that it cannot see or explain the plan, and the prompt and
  a case in the evaluation hold it to that.
