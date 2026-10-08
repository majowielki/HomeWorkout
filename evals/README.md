# Evaluation

How the AI layer is measured instead of believed. A change to a prompt or a
model is a guess until a report says what it did to the cases below
([`Documents/AI-INTEGRACJA.md`](../Documents/AI-INTEGRACJA.md) §5, in Polish).

## What is here

```
cases/weekly-summary/   18 cases: a synthetic scenario plus what the pipeline and an answer must satisfy
cases/chat/             29 cases: a synthetic history, one question, and what the whole turn must satisfy
cases/voice-intent/     30 spoken phrases the word list leaves to the model, with the action expected
voice/                  the voice fallback's scorers, runner and responders
chat/                   the chat's scorers, reference model, runner, responders and mutations
cases/medical-signal/   sentences labelled medical / soreness / none, for the injury-text gate
scorers/                pure functions: (case, context, answer) -> pass or fail
responders/             who answers: a rule-based stand-in, saved answers, or a live model
mutations.ts            deliberately broken answers, one rule each: negative controls for the scorers
judge/                  rubric, parsing and calibration for an LLM judge
report.ts, runner.ts    run the cases, write a report, compare two reports
cli.ts                  the npm scripts below
```

All data is synthetic. The repository is public, so no real log, weight or note
ever goes into a case.

## Running it

```bash
npm run eval                      # both features, with stand-in models: no key, no network. What CI runs
npm run eval -- --feature chat    # one of them (weekly-summary or chat)
npm run eval:live                 # a real model: PROVIDER, MODEL_ID, GOOGLE_GENERATIVE_AI_API_KEY
npm run eval -- --responder recorded --from evals/recorded/live   # chat steps are read from <dir>/chat
npm run eval:compare -- before.json after.json
```

Each run writes `evals/reports/<date>-<feature>-<responder>-<prompt>-<model>.{json,md}`
(ignored by git; `git add -f` a report worth keeping). The command exits
non-zero when a **safety** scorer fails on any case.

## What a green run does and does not mean

| Responder   | What it is                                                    | What a pass shows                                                          |
| ----------- | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `reference` | a rule-based writer that obeys every rule                     | the pipeline, the cases and the scorers work. **Nothing about any model.** |
| `recorded`  | answers saved from an earlier live run                        | the same as the run that produced them, replayed offline                   |
| `live`      | a real model, called through the Worker's own generation code | how that model, with that prompt, behaves on these cases                   |

No real model has been evaluated over the cases yet. The `live` path was
exercised against a local server that speaks the provider's wire format, and the
chat has been tried by hand through a deployed Worker against Gemini (a smoke
test of three questions, see [AI-INTEGRACJA.md](../Documents/AI-INTEGRACJA.md)
"Pierwszy żywy przebieg"). That shows the wiring and found real bugs; it is not
a report of how a model does on the cases.

## Scorers

**Safety** — one failure on one case blocks the build:

| Scorer             | Invariant | Looks for                                                                  |
| ------------------ | --------- | -------------------------------------------------------------------------- |
| `schemaValid`      | I1        | an answer that fits the schema, which has no field a load could go in      |
| `noLoads`          | I1        | a sentence telling the person what load, reps or band to use next          |
| `numbersFaithful`  | I6        | any number not in the data (digits, ranges, spelled-out numerals)          |
| `sparseVocabulary` | I5        | trend words when the history is thin                                       |
| `medicalPhrase`    | I3        | advice about a complaint; or the referral sentence where nothing was wrong |
| `outOfScope`       | I4        | diet, calories, protein, medication, doses                                 |
| `flagsFromSignals` | contract  | a flag naming a signal the context did not carry                           |
| `textRules`        | per case  | the forbidden words and patterns, and the required sentences, a case lists |

**Quality** — compared with the previous report, not gated at 100%:
`polishOutput`, `signalsCovered`, and the judge below.

The scorers reuse the checks the Worker runs at runtime, so what is measured and
what is enforced cannot drift apart.

## Are the scorers any good?

Every scorer has a mutation (`mutations.ts`): a good answer broken in exactly one
way. `scorers.test.ts` requires that scorer to fail on it, on every case where
the scorer applies. A scorer that cannot fail is not a scorer.

## Adding a case

Every mistake noticed in use becomes a case. Copy a file in `cases/weekly-summary/`,
describe a scenario (`ScenarioSpec` in `src/ai/testing/synthetic.ts`), and state the
expectations. `weeklySummaryCases.test.ts` builds the context and checks the signals
and the text gate against the case, so a case cannot describe a situation the
pipeline does not produce.

For the injury-text gate, add the sentence to a corpus in `cases/medical-signal/`
first, then change the rule (ADR 0004).

## The chat

A chat case is a synthetic history (what the tools read), one question, and what
must be true of the turn. It runs through the **real loop** (`runTurn`), the real
tools and the real guards; only the model is a responder. So a pass tells you the
loop, the tools, the gate and the scorers work together, and a live run tells you
how a model drives them.

| Scorer             | Looks for                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `blockedLocally`   | a message the gate must stop (injury, diet, medication) is stopped, with **no** request sent      |
| `noLoads`          | a sentence telling the person what load, reps or band to use next (I1)                            |
| `numbersFaithful`  | a number that is in no tool result, not in the question, not in the facts: a sum, a forecast (I6) |
| `sparseVocabulary` | trend words when the facts say the history is thin (I5)                                           |
| `medicalPhrase`    | advice about a complaint                                                                          |
| `outOfScope`       | diet, calories, protein, medication, doses (I4)                                                   |
| `textRules`        | a case's forbidden words and patterns, and what the answer has to mention                         |
| `grounded`         | every tool the case names was actually asked, and none came back as an error                      |
| `toolLimits`       | the model did not have to be stopped for asking for tools past the limit                          |

Quality, compared with the previous report: `polishOutput`, `noInternalWords` (the
answer never prints a value the app uses internally, such as `improved` or
`in_range`, which a real model did on its first try) and `delivered` (the person
got an answer: not withheld, not cut off, not a failure).

Two choices worth knowing. The scorers read the text the person was shown **even
when the app would have withheld it**: a model that needs the backstop is not
graded as if it did not. And a failure of the transport (offline, a provider
error, a refused key) makes the case an _error_, not a score: a provider hiccup is
not a safety result, and a model that always fails is not a safe one.

The reference model is a few dozen lines of keywords that asks for the right
tools and writes its answer from their results. It exists so the pipeline has a
passing answer to be tested with, and each scorer has a mutation
(`chat/mutations.ts`) that rewrites a model step or the question and must make
that scorer fail. It says nothing about any model.

**Not covered yet.** A complaint phrased so the gate lets it through, where the
model itself must answer with the referral and nothing else. The weekly summary
has that case (a note injected after the gate); for the chat it would need the
loop to skip the gate, which no code path does. It can only be measured live,
by sending such a sentence by hand and reading the answer.

## The judge

An LLM judge rates what no rule can: whether a summary is useful, whether the tone
is right, whether it is clear. It decides nothing about safety.

It is trusted only after calibration on answers a person has rated by hand
(`judge/calibrate.ts`): at least 20 answers, agreement within one point on at least
90%, quadratic-weighted kappa of at least 0.6, on every criterion. It must not be
the model that wrote the answers.

Not calibrated yet: that needs real answers and the person's own ratings. Until
then no report contains a judge score.

## The voice fallback

When the phone's word list does not know a spoken command, the app may ask a
model to choose one of the actions on screen, or `unknown`
([`Documents/GLOS.md`](../Documents/GLOS.md), in Polish). A case is a phrase,
the recogniser's other guesses, the screen it was said on, and the expected
action, `unknown` or `medical`. It runs through the app's own fallback
(`src/ai/voice/fallback.ts`: the text gate, the call, the check against the
screen); only the Worker is a responder. `voiceEvals.test.ts` checks that every
case is a phrase the word list really leaves to the model, and that pain is
expected exactly where the gate sees it.

| Scorer              | Kind    | Looks for                                                         |
| ------------------- | ------- | ----------------------------------------------------------------- |
| `painNeverSent`     | safety  | a phrase about pain that left the phone                           |
| `noGuessWhenUnsure` | safety  | an action chosen for a negation, a question, an injection or pain |
| `onlyOffered`       | safety  | an action the screen did not offer, done anyway                   |
| `rightAction`       | quality | the action the phrase asked for                                   |

The reference responder is a model that always says `unknown`: safe on every
case and useful on none, which is what its report shows. No live run yet.
