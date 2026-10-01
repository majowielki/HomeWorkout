# 0003 — What we deliberately do not do, and why

- Status: accepted
- Date: 2026-10-01

## Context

A first research report proposed a long list of techniques for a fitness
app with AI. Each was checked against this project's size (one user,
about 60 exercises, a call a day at most) and against the claims in the
report (many of which did not survive checking; see
`Documents/WERYFIKACJA-RESEARCH-AI.md`). Knowing what to leave out, and
saying why, is part of the engineering.

## Decision

| Idea                                                    | Not doing it, because                                                                                                                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RAG with a vector database**                          | The whole "knowledge base" is the exercise catalogue, about 2-3 thousand tokens. It fits in the prompt in full; retrieval would be a search over an array we can pass whole.                                              |
| **On-device model** (llama.rn, ExecuTorch, 1-3B models) | Weak Polish and weak reasoning about constraints, 1-2.5 GB to download, another native module. The AI features run once a day or a week, so offline and low latency are not needed; the core is offline anyway.           |
| **Gemini Nano as an offline fallback**                  | The device is supported, but the Prompt API is in beta, structured output is alpha, and there is no Expo integration. Possible later as a Kotlin Expo module.                                                             |
| **Fine-tuning (LoRA)**                                  | There is no training data, and the domain knowledge lives in the engine and the catalogue, not in model weights.                                                                                                          |
| **Llama Guard, Prompt Guard, NeMo Guardrails**          | General classifiers know nothing about this knee. `screenExercise`, `validatePlan` and output guards protect this domain better and can be tested.                                                                        |
| **Routing across models to save cost**                  | The cost is cents a month. The provider abstraction stays, for comparing quality (AI-INTEGRACJA §5.4), not for saving money.                                                                                              |
| **Canary tokens in the prompt**                         | The prompt is in a public repository; there is nothing to protect.                                                                                                                                                        |
| **Play Integrity API**                                  | An app installed from a local build is reported as `UNRECOGNIZED_VERSION`, and verifying a token needs a Google service account in the Worker. A shared secret, a rate limit and a daily budget do the job at this scale. |
| **OpenTelemetry export from the Worker**                | Native export needs the Workers Paid plan and is billed from 2026-10-01; the community library has had no release since 2025-05. Structured logs plus AI Gateway analytics are enough.                                    |
| **MSW in the app's tests**                              | It does not load under jest-expo. The HTTP client takes `fetch` as a parameter, which is simpler.                                                                                                                         |

## Consequences

- None of these closes a door. Each has a stated reason, so reopening one
  starts from "what changed?" rather than from "why didn't we?".
- The list is part of the evidence (AI-INTEGRACJA §9): a reviewer who asks
  "why no RAG?" gets a sized answer.
