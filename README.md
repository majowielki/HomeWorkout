# HomeWorkout

A single-user, offline-first workout tracker for training at home with a
very specific set of constraints — and a rules engine that respects them.

> **Status:** early development, milestones M0–M6 done and reviewed (see
> [`Documents/IMPLEMENTACJA.md`](Documents/IMPLEMENTACJA.md) §0 for the milestone
> table and every deliberate deviation from the plan). Android only.
> The UI is in Polish by design; code, tests and documentation are in English.

## What makes it interesting

Most trackers are a spreadsheet with a timer. This one has to answer a
harder question: _what is safe and useful for this body, with this
equipment, today?_

- **A knee with no collateral ligaments and a reconstructed ACL.** Every
  exercise in the catalogue is tagged with its biomechanics (plane of
  motion, kinetic chain, stance, force profile, valgus/varus and
  anterior-shear risk). A pure-TypeScript safety filter turns that into
  exclusions with a reason code — and it has a `loadsKnee` gate so that
  frontal-plane _shoulder_ work isn't caught in the net. The exact
  exclusion set for the real catalogue is pinned by a test.
- **Two adjustable dumbbells that total 20 kg.** Loads are a discrete
  ladder derived from the plates actually in the box (2–10 kg per hand
  paired, 2–18 kg on a single bar), not free-form kilograms. The smallest
  step is 2 kg, which is +25% at the light end — so progression is gated on
  rep targets, never on a percentage.
- **Resistance bands with no unit of load.** Band sets are logged as
  (band, anchor position 0–3) and progressed along that grid. Calibration
  against the dumbbells is planned; the heaviest band will never have a
  curve, and the design treats that as the main path, not an edge case.
- **Weight loss on a GLP-1/GIP agonist.** The programme targets lean-mass
  retention in a caloric deficit: low weekly volume, full-body sessions,
  2–3 RIR on compounds, frequent deloads that cut volume but never load.
- **A human in the loop, then an LLM.** The rules engine owns every number.
  The planned AI layer only interprets, and its output is validated by the
  same schema before it can touch a plan.

## Architecture

```
app/            expo-router routes — thin, no logic
src/domain/     pure TypeScript rules engine — no React, Expo or DB imports
                (enforced by an ESLint rule; 100% test coverage required)
src/ai/         the optional AI layer: strict contract, context builder, versioned
                prompts — pure, and held to the same 100% coverage gate
src/db/         Drizzle schema, migrations, repositories (the only SQL — lint-enforced)
src/features/   screen-level components composed from the layers below
src/components/ shadcn-style UI kit on NativeWind
data/           exercise catalogue and workout templates (JSON + Zod)
scripts/        CI validation and media import
evals/          evaluation cases for the AI layer (synthetic data only)
docs/adr/       architecture decision records
```

`src/domain` is the point of the project. It is the part that decides what
load to put on an injured knee, so it is the part that is exhaustively
tested and kept free of anything that needs a device to run.

## The AI layer

An LLM never touches a number that matters. The rules engine owns every
load; a model is asked to _comment_ on a weekly snapshot the app computes
in code, and its answer has to be a typed object that passes a schema
before the app looks at it. Today the person pastes the brief into a chat
by hand to judge whether the answers are worth an integration; the Worker
that makes the call is the next stage. What is built so far, and why each
part exists:

- **A strict context contract.** Every object lists its fields, so a new
  database column cannot reach a prompt by accident. The person can read
  the exact text before anything is copied or sent.
- **A text gate that runs before any network call.** Notes that read as an
  injury, or that touch diet or medication, never reach a model. It is a
  lexicon, measured and documented as a first layer rather than a
  guarantee ([ADR 0004](docs/adr/0004-the-text-gate-is-a-floor.md)).
- **Versioned prompts.** A published prompt is pinned by a hash in a test;
  changing it means a new file and an evaluation report.
- **No call to a real model in CI.** Everything above is deterministic.

The decisions are in [`docs/adr/`](docs/adr/), including what was
deliberately left out and why ([ADR 0003](docs/adr/0003-what-we-do-not-do.md)).
The working plan is in Polish: [`Documents/AI-INTEGRACJA.md`](Documents/AI-INTEGRACJA.md).

## Stack

Expo SDK 57 (dev build) · React Native 0.86 · TypeScript · expo-router ·
expo-sqlite + Drizzle ORM · NativeWind 4 · Zustand · Zod · jest-expo +
Testing Library.

## Running it

Requires Node 22, Android Studio with an SDK, JDK 17 and a device or
emulator on `adb`.

```bash
npm install
npx expo run:android      # native build + install, needed after native deps change
npx expo start            # subsequent JS-only iterations hot-reload
```

Quality gates (also run in CI on every push):

```bash
npm run verify            # lint, format, typed routes, typecheck, data validation, tests
```

## Data and licensing

Code is MIT. Exercise demonstration frames in `assets/exercise-media/` come
from [free-exercise-db](https://github.com/yuhonas/free-exercise-db) and are
public domain (The Unlicense); the mapping is in
[`data/media-sources.json`](data/media-sources.json). The exercise
taxonomy itself is authored in this repository.

## Not medical advice

The safety filter encodes constraints from a research summary, not a
clinical assessment. It runs in a conservative mode (bilateral-only lower
body) until a physiotherapist has reviewed the exercise list, and the app
is built for one specific person. Do not use it as a substitute for
professional guidance.
