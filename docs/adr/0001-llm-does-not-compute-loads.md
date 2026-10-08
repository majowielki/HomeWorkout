# 0001 — The language model never computes a load

- Status: accepted
- Date: 2026-10-01

## Context

The app is built for one body with a right knee that has no collateral
ligaments and a reconstructed ACL, and for two adjustable dumbbells that
move in 2 kg steps. A load that is wrong by one step is +25% at the light
end; a band position that is wrong by one is a different exercise. Both
are decisions where a confident, fluent, slightly wrong answer is worse
than no answer.

Language models are poor at exactly this: arithmetic is not reliable in a
transformer, and a model asked "how much next week?" will answer with a
plausible number.

## Decision

1. **The schemas a model must fill have no field a load can go into** —
   no kilograms, no band, no position, no repetition target. This is the
   mechanism; the sentence in the prompt is a second layer, not the first.
   (`weeklySummarySchema`; test: "has no field a load could go into".)
2. **Every number a model may quote is computed in code and handed over**:
   weekly volume, per-exercise trends, the 7-day weight mean, the signals.
   The prompt tells the model to copy, never to add, round or estimate,
   and an evaluation scorer (`numbersFaithful`) fails an answer that
   contains a number the input did not.
3. **A model's proposal about a plan is only a proposal.** It passes
   `validatePlan` (SPEC §8), is shown to the person as a difference
   against the engine's own plan, and becomes `source: 'ai_accepted'` only
   after they accept it. No path from a model's answer to a stored plan
   bypasses that (an architectural test will pin it when plans exist).

   _Amended 2026-10-08 by [ADR 0006](0006-the-coach-composes-days-from-the-engines-options.md):_
   the model may now compose days from the engine's options, with the person's
   consent; points 1 and 2 stand, and the architectural test exists
   (`src/__tests__/architecture.test.ts`).

## Alternatives considered

- **Let the model propose loads inside clamps** (±X% of last time). The
  clamp SPEC §8 once described cannot work on a 2 kg ladder, and the
  model would still be choosing among states it cannot evaluate.
- **Validate afterwards only.** Cheaper to build, but it makes the
  model's output the source and the engine the filter. It also produces
  plans that are silently trimmed, which the person cannot learn from.

## Consequences

- The model cannot help with progression. That is the point; the rules
  engine owns it and is exhaustively tested (100% coverage gate). It can
  help shape which movements a day holds (ADR 0006), never how heavy.
- If the model is ever allowed to choose exercises (F5), `exerciseId` is
  a `z.enum` of the ids that passed `screenExercise`, so it cannot name an
  excluded one, and `validatePlan` still checks.
- Answers can only be as specific as the context. Adding a number the
  model should be able to quote means computing it first.
