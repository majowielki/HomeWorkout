# 0006 — The coach composes days from the engine's options

- Status: accepted
- Date: 2026-10-08
- Amends: [ADR 0001](0001-llm-does-not-compute-loads.md), point 3 and its consequences

## Context

ADR 0001 kept the model out of every number that matters and left plans to
the engine: a model's suggestion about a plan was "only a proposal", and the
consequences said plainly that the model could not help shape training. E7
(contract v3) went one step further with requests — rest, a lighter day,
leave a muscle out, an extra session — that the engine turns into a plan.

In use that is a thin conversation. The person can say what they do not
want, but not what they would like the day to be ("tomorrow only upper body,
and keep it short"), and the coach cannot answer "why can't I do squats on
Thursday?" with anything better than a reason code. The person wants a coach
that composes days with them, in step with the engine: asks when a request is
unclear, draws simple conclusions from what the engine reports, and proposes
a day the engine can actually build.

The dangers ADR 0001 named have not changed: a load one step off is +25%,
the knee rules must hold, and a fluent model is poor at arithmetic.

## Decision

1. **The engine offers, the model chooses.** For any day of the planned week
   the engine lists its options: every movement slot with the block's
   exercise, whether it can be trained that day and, if not, the reason
   (recovering, sore, at the weekly maximum, excluded, avoided by request …),
   and the sets it would give. The model may compose a day only from the
   available options, and may ask for fewer sets than the engine offers,
   never more. It does not name exercises, loads, repetitions, RIR or time.
2. **The engine builds and checks the composed day.** A composition goes
   through the same functions as any day (`selectCustom` → `buildDay` →
   `validatePlan`): loads from the real logs, the time budget, deload, the
   knee rules. What the engine could not take is returned to the model as
   conflicts with reason codes, which the model explains or works around.
3. **The person decides.** A composition is a preview with the difference
   against the engine's own week, applied only when the person presses
   "Zastosuj" (as in E7). Applied, it is stored as a request
   (`compose_day`), visible in the calendar and withdrawable there.
4. **The engine keeps checking.** A composed day is re-checked on every look
   at the plan, like any planned day. If a movement stops being possible
   (soreness reported, the weekly maximum reached, the block rotated), the
   engine drops it, says why in the change banner, and falls back to its own
   choice when nothing of the composition is left.
5. **Conversation, not commands.** The prompt asks the model to ask when a
   request is ambiguous (which day, which muscles, how hard the soreness is)
   and to explain the engine's reasons in plain words before proposing. The
   text gate, the output guards and the load guard of ADR 0004/0005 still
   apply to every reply.

ADR 0001 points 1 and 2 stand unchanged: no schema a model fills has a field
a load could go into (now pinned by `src/__tests__/architecture.test.ts`
for every tool input), and every number a model quotes is computed in code.

## Alternatives considered

- **Priorities only** — the model tells the engine what to focus on and the
  engine composes. Safer, but the person cannot get the day they asked for,
  and the model cannot explain a choice it did not make.
- **The model writes the day, the engine only computes loads.** Most freedom;
  it makes the model's output the source and the engine a filter, which ADR
  0001 rejected for good reasons (silently trimmed plans, states the model
  cannot evaluate).
- **Apply small changes without asking.** Fewer taps, but a stored plan the
  person did not see is exactly what the consent boundary is for.

## Consequences

- Contract version 4, prompt `chat/v4`, two tools (`getDayOptions`,
  `proposeDayPlan`), migration 0008 (`plan_constraints.items`) and backup
  format v5. The app and the Worker are deployed together, as for v3.
- The model's freedom is bounded by the engine's options: it cannot add a
  slot the engine refused, raise the sets above the engine's, or move a day
  the person rests. Every such attempt is a conflict the model must explain.
- A composed day can lose movements later. That is the engine doing its job;
  the banner says why, as for any changed day.
- The architectural test that ADR 0001 promised now exists: the functions
  that store a plan are called only by the planning orchestration, which takes
  plans from the engine and never reads a model's text.
- Not yet measured: how well a real model asks and composes. The evaluation
  cases run against the rule-based stand-in; a live report is the next step.
