# 0002 — Data and domain stay on the phone; the Worker is stateless

- Status: accepted
- Date: 2026-10-01

## Context

The app is offline-first: the log, the rules engine and the safety filter
run on the device and need no network. A language model needs a server
(a provider key must never ship in an APK) but should add a layer on top,
not become a dependency of the core.

The repository is public and the person's data is about their body. What
leaves the device, and what is kept elsewhere, is a design decision.

## Decision

1. **The database, the rules engine, `validatePlan` and the medical
   signal gate live on the phone.** Nothing about the core needs the
   network, and with AI switched off the app is unchanged.
2. **The Cloudflare Worker is a stateless proxy**: authenticate, limit,
   apply a versioned prompt, call the provider through the AI SDK, validate
   the answer's shape (one repair attempt), apply output guards, log
   metadata. It has no database and knows nothing about the person beyond
   the request in front of it.
3. **The request carries the minimum, as a closed schema.** `CoachContext`
   is strict at every level, so a new column cannot reach a prompt by
   accident. It holds constraint codes instead of a diagnosis, a goal code
   instead of a drug name, and only the notes that passed the text gate.
   The person can read the exact text before anything is copied or sent.
4. **Tools for the chat feature (F4) run on the phone.** The Worker returns
   a tool-call request, the phone executes it against the local database
   and sends the result back. Proven in the proof of concept: a tool
   without `execute` ends the step and hands the call back (D1).
5. **Logs are metadata only**: request id, feature, versions, model,
   token counts, latency, validation outcome, estimated cost. Full
   exchanges are stored on the phone, in `ai_exchanges`, and nowhere else.

## Consequences

- Shape is validated twice (Worker and phone). That is not redundancy: app
  and Worker versions can drift, and the domain data only exists on the
  phone. Both sides send and check `contractVersion`.
- A multi-step lookup costs a round trip per step, and each carries its
  context. At one user and a few calls a week that is cents.
- The provider sees the content of each request. This is documented in
  the README rather than hidden: minimisation limits what it sees, it does
  not make it nothing.
- A leaked app secret lets someone call the Worker. The worst case is one
  day's token budget (see the threat model in AI-INTEGRACJA §4.7).
