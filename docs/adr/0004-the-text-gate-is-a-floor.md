# 0004 — The injury-text gate is a floor, not a guarantee

- Status: accepted
- Date: 2026-10-01

## Context

Free text is the one input the app cannot structure. A note such as
"kolano strzyka" must never be answered as if it were a training fact: the
app owes the person a fixed sentence and a pointer to a professional, and
nothing from a model (AI-INTEGRACJA I3).

The first plan was a lexicon of Polish stems with context rules, and a
research report suggested edit-distance matching instead. Both were
measured.

## Decision

`detectTextSignal` (`src/domain/coach/medicalSignal.ts`) is a stem lexicon
with negation, clause splitting, a muscle-versus-joint distinction, a
filter for adjectives built on a joint name ("wyciskanie barkowe") and a
safe-side rule: a joint named with no sign that all is well is read as a
possible complaint. Where two readings are close, `medical` wins.

It runs on the phone before anything is sent. A note that reads as an
injury is withheld from the context, counted on screen, and answered with
one fixed sentence. A second, independent layer covers what slips past it:
the prompt's `medical_guardrail` and, with the Worker, an output guard.

**It is documented as a first layer with known recall, not as a guarantee.**

## What was measured

Three corpora, all written by the author of the rules, none an estimate
of accuracy on real notes:

- **dev** (38 sentences, from the proof of concept): the stem approach
  scored 37/38 against 29/38 for edit distance with no context. The one
  miss is an idiom ("bolesna prawda"), accepted on the safe side.
- **held-out** (78): all correct, but written with the rules in view, so
  it is a regression suite.
- **unseen** (36), written after the rules were frozen, probing for gaps:
  **21/36 on the first run; of 23 medical notes the lexicon caught 8.** It
  was blind to indirect language ("mam problem z kolanem", "kolano daje o
  sobie znać", "pobolewa", a doctor's findings). The gaps were closed, the
  joint-without-all-clear rule added, and the set kept as a regression
  suite.

## Consequences

- The corpora are regression suites. Real accuracy is unknown until it is
  measured on the person's own notes, kept locally and never committed
  (the repository is public); this is a task for the usage gate before A1.
- Over-triggering is expected: any note that names a joint without a
  reassuring word ("kolano ok", "pilnowałem") is withheld. For an app
  built around one knee that is the right direction to be wrong in; the
  cost is a missing note and one fixed sentence.
- No sentence anywhere may say that injuries are "detected". The
  evaluation includes a case where an injury note bypasses the gate on
  purpose, so the second layer is measured on its own.
- A new miss found in use becomes a case in
  `evals/cases/medical-signal/` first, then a rule.
