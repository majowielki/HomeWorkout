# HomeWorkout

A single-user, offline-first workout tracker for training at home with a
very specific set of constraints — and a rules engine that respects them.

> **Status:** early development, milestones M0–M5 done (see
> [`Documents/IMPLEMENTACJA.md`](Documents/IMPLEMENTACJA.md)). Android only.
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
src/db/         Drizzle schema, migrations, repositories (the only SQL)
src/features/   screen-level components composed from the layers below
src/components/ shadcn-style UI kit on NativeWind
data/           exercise catalogue and workout templates (JSON + Zod)
scripts/        CI validation and media import
```

`src/domain` is the point of the project. It is the part that decides what
load to put on an injured knee, so it is the part that is exhaustively
tested and kept free of anything that needs a device to run.

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
