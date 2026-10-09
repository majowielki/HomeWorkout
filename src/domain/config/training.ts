/**
 * Every tunable number the rules engine uses, in one place — separate from
 * the logic so it can be adjusted against the body's actual response
 * without touching an algorithm. See SPEC-silnik-regul.md §1.3 and
 * PLAN.md §10.1 for why these values are expected to drift.
 */

import type { MovementPattern, MuscleGroup } from '../types';

export interface BandConfig {
  anchorStepCm: number;
  minCalibrationPoints: number;
  linearR2Threshold: number;
  minLengthStepCm: number;
  recalibrateAfterCycles: number;
  recalibrateAfterDays: number;
  romCm: Record<MovementPattern, number>;
}

export const BAND_CONFIG: BandConfig = {
  /**
   * Spacing between the tape marks on the floor. The app dictates it (like
   * it dictates the four positions) so P2 means the same thing in every
   * session: band start length = rest length + position * step.
   */
  anchorStepCm: 30,

  /** A fit needs at least this many (mass, length) pairs. SPEC §5.5 step 4. */
  minCalibrationPoints: 4,

  /** Linear fit is accepted at or above this R²; otherwise quadratic. SPEC §5.5. */
  linearR2Threshold: 0.97,

  /**
   * When the length gained from one mass to the next drops below this,
   * the band has stopped stretching measurably and the wizard suggests
   * stopping. SPEC §5.5 step 3.
   */
  minLengthStepCm: 1,

  /** Recalibration nudge: whichever comes first. SPEC §5.6 "Zużycie". */
  recalibrateAfterCycles: 5000,
  recalibrateAfterDays: 183,

  /**
   * How much further the band stretches over one concentric, by movement
   * pattern. Rough anthropometric guesses for an adult male — a press or
   * row travels about an arm's length, an isolation move less. They only
   * feed a *range* shown with "≈", never a number with decimals, and the
   * range already spans start-to-end of the rep, so an error here widens
   * or shifts an admittedly fuzzy interval rather than misstating a load.
   */
  romCm: {
    Squat: 40,
    Hinge: 40,
    Lunge: 35,
    Push: 50,
    Pull: 50,
    Carry: 10,
    Isolation: 30,
    Core: 25,
    Cardio: 0,
    Mobility: 20,
  },
};

/**
 * Volume targets. The lower bound is well documented; the upper bound is a
 * tuning parameter. SPEC-silnik-regul.md §4.1 lists more keys — they join
 * this object with the modules that read them (M7).
 */
export const TRAINING_CONFIG = {
  weeklyWorkingSetsPerMuscle: { min: 3, target: 4, max: 6 },
  /** A set counts as "working" up to and including this RIR. SPEC §4.2. */
  workingSetMaxRir: 4,
  /** A secondary muscle receives this fraction of a set. SPEC §4.2. */
  secondaryMuscleWeight: 0.5,
  /**
   * Muscles that are primary in many slots get a higher weekly maximum of
   * direct sets. Glutes are primary in the squat, the lunge, the hinge and
   * the bridge; the back in rows, pulldowns, carries and back extensions.
   * With 6, the 3-set minimum of quads and hamstrings (or of lats and
   * forearms) cannot both be met: the simulation of 2026-10-02 showed one
   * of each pair below its minimum on most days. The upper bound is the
   * tunable one (SPEC §4.1).
   */
  maxDirectSetsOverride: { glutes: 8, back: 8 } as Partial<Record<MuscleGroup, number>>,
  /** Never hard sets for a muscle, whatever the catalogue lists as primary. SPEC §4.2 v1.2. */
  volumeExcludedPatterns: ['Mobility', 'Cardio'] as readonly MovementPattern[],
} as const;

/**
 * Ranking of a replacement exercise, SPEC §3.4. The weights favour what
 * protects a reconstructed ACL (hinge, both feet down, closed chain) over
 * a mere match of pattern; below the threshold nothing is offered, because
 * a bad substitute is worse than none.
 */
export const SUBSTITUTE_CONFIG = {
  sharedPrimaryWeight: 50,
  hingeWeight: 30,
  bilateralWeight: 20,
  closedChainWeight: 10,
  samePatternWeight: 5,
  threshold: 40,
} as const;

/**
 * What a preference of the person may decide (engine v2, 12 §3-§4). It breaks
 * ties between near-equivalent options; it never breaks a rule.
 */
export const PREFERENCE_CONFIG = {
  /** Two exercises of one slot are near-equivalent when each is at least this good a substitute for the other (of 115). */
  nearEquivalentScore: 70,
  /** The weight of a preference in choosing a day's slots, against 2 for a volume deficit. */
  scoreWeight: 0.25,
  /** A variant the person would rather avoid is not chosen if another was not used in the last this many blocks. */
  avoidedLookbackBlocks: 2,
} as const;

/**
 * Days since the last session at which each layoff tier starts, SPEC §6.3.
 * One table for the engine and for the AI signals, so "a short layoff"
 * means the same in a plan and in a weekly summary.
 */
export const LAYOFF_FROM_DAYS = { short: 8, medium: 15, long: 31 } as const;

/**
 * Double progression over every load ladder, SPEC §5.1, §5.4 and §5.8.
 * Apart from the rules quoted from the SPEC these are tuning parameters,
 * not research results.
 */
export const PROGRESSION_CONFIG = {
  repStep: 1,
  /** Holds progress in 5-second steps. */
  timeStepSec: 5,
  /** The first N sessions of an exercise run at `introRir` (FIRST_EXPOSURE). */
  introExposures: 2,
  introRir: 4,
  /** An exercise not done for this long comes back one step lighter (RE_EXPOSURE). */
  reExposureAfterDays: 31,
  /** Sessions at `introRir` after a layoff of LAYOFF_FROM_DAYS.long or more. */
  recalibrationSessions: 2,
  /** A never-done band exercise starts here. SPEC §5.4. */
  bandStartPosition: 1 as const,
  /**
   * SPEC §5.6 asked for a logged warm-up set before the first band set and
   * set aside a first set without one (WARMUP_MISSING). Off since v1.3
   * (2026-10-07): logging warm-up sets felt pointless in use; the Mullins
   * effect is met by a cue to stretch the band a few times first.
   */
  requireBandWarmup: false as boolean,
  /** Above this jump in estimated force, a new band starts at P0, not P1. SPEC §5.4. */
  bandMacroMaxJump: 0.15,
  /**
   * The most repetitions a set may be pushed to before the next step is a harder variant, not more
   * repetitions (engine v2, D34). Lower where the knee is loaded: a long set at a high rep count is a
   * different kind of stress than the rep range was chosen for; to be confirmed with the physiotherapist.
   */
  repCap: { default: 25, kneeLoading: 20 },
  /** Used only when a slot lacks the range a candidate needs (the data check prevents it). */
  fallbackRepRange: [8, 15] as [number, number],
  fallbackTimeRange: [20, 60] as [number, number],
} as const;

/**
 * What the second engine's progression decides with (03 §5-§7, §12-§17, 13 §4-§8, §16, §20). The
 * numbers it shares with the first engine (rep step, intro RIR, layoff tiers) stay in
 * `PROGRESSION_CONFIG` and `LAYOFF_FROM_DAYS`. Tuning parameters, not research results.
 */
export const PROGRESSION_V2_CONFIG = {
  /** The first set must reach the top of the range; the others may fall short of it by this much (D30). */
  dropOffAllowance: 1,
  /** Comparable failures in a row, at one resistance and one range, that bring the resistance a step down (03 §6). */
  failuresToRegress: 2,
  /** A step up of at least this fraction, or an unknown one, is first tried with one probe set (D28). */
  probeJumpThreshold: 0.15,
  /** Exposures at the top of the range that must pass after a failed probe before the next one (D28). */
  probeCooldownExposures: 2,
  /** A failed step is forgotten after this many days without an exposure at either of its two resistances (D23). */
  failedRungExpiryDays: 42,
  /** How far above the range the top may be extended, in reps and in seconds (D23, D29). */
  extendBy: { reps: 5, duration: 15 },
  /** The axes between "hold" and "step up" that may be used while a step is remembered as failed (03 §8). */
  axes: { addSet: true as boolean, extendRange: true as boolean },
  /** The best required set at or under this share of the bottom of the range proposes an easier variant (D39). */
  variantDownRatio: 0.5,
  /** Exposures built from the same result in a row that propose an easier variant (D39). */
  variantDownStalledExposures: 2,
  /** Complete exposures at the top of the range, in a row, before a harder variant is proposed (13 §9). */
  variantUpTopExposures: 2,
  /** A set done this easily (reps in reserve) and at the top of the range proposes a step up in the session (D24). */
  calibration: { maxStepsUp: 2, upEffortAtLeast: 3, maxStepsDown: 1, downEffortAtMost: 1 },
  /** Exposures made only of untouched suggestions that ask for a confirmation before a step up (D20). */
  autopilotExposures: 2,
  /** Pairs of exposures needed before the person's reporting bias is stated, and the effort it is read from (D33). */
  rirBias: { minPairs: 5, maxEffort: 1 },
} as const;

/**
 * Sets of an exposure (engine v2, 12 §5): fewer, longer exposures of the same weekly volume give each
 * a fuller body of evidence and leave room for the `add_set` axis. The first engine plans 2 everywhere
 * (`PLANNER_CONFIG.setsPerExercise`); this takes its place when the second engine is switched on.
 */
export const SETS_CONFIG = {
  byKind: { compound: 3, accessory: 2, core: 2, filler: 2 },
  /** In a deload week an exposure keeps this share of its sets, but never fewer than one. */
  deloadFactor: 0.5,
  /** What the engine plans itself; a request goes beyond it with advice, up to `technicalMax`. */
  plannerMax: 6,
  /** What the data can hold: a hard limit, not a training one. */
  technicalMax: 10,
} as const;

/**
 * The reactive deload of the second engine (03 §16, D31): there is no planned deload week; one
 * starts when the signals ask for it. Tuning parameters.
 */
export const DELOAD_V2_CONFIG = {
  /** Not before this many days into a block (the request of the person excepted). */
  minDaysIntoBlock: 7,
  /** A key exercise has stalled after this many exposures in a row with no progress. */
  stallExposures: 2,
  /** This many key exercises must have stalled at once. */
  stallExercises: 2,
  /** Sleep or energy of the last days that makes a stall a sign of fatigue. */
  fatigueWindowDays: 3,
  lowSleepHours: 6,
  lowEnergy: 2,
} as const;

/**
 * Which variant a slot gets for the next block (03 §9, 12 §4.2). A variant that is still giving
 * progress, or has not been done enough to say, stays. To be set after the benchmark and kept with
 * the policy version; these are placeholders, not research results.
 */
export const ROTATION_CONFIG = {
  /** Fewer qualified exposures in the block than this say nothing about whether the variant works. */
  minQualifiedExposures: 3,
  /** Progress is looked for among this many of the latest qualified exposures of the block. */
  progressWindow: 3,
} as const;

/** The volume lever (13 §19, D32): a recommendation to raise or lower the weekly maximum of a muscle. */
export const VOLUME_LEVER_CONFIG = {
  /** The change of the maximum, up (rounded up) or down (rounded). */
  change: 0.2,
  /** A muscle must have been trained without a break this long before more is recommended. */
  minTrainingDays: 28,
  /** Exposures with no progress in a row, for each key exercise of the muscle. */
  stalledExposures: 2,
  /** No sore day this bad within this many days, for more. */
  noSorenessDays: 14,
  /** Sore on this many of the last this many days, for less. */
  soreDays: 3,
  soreWindowDays: 7,
  /** The top of the "higher" profile, 4/6/10: the lever does not go past it. */
  ceiling: 10,
} as const;

/** Overload signals, SPEC §6.1. */
export const AUTOREGULATION_CONFIG = {
  /** Only sessions this recent can raise FATIGUE_HIGH or PERFORMANCE_DROP. */
  signalWindowDays: 14,
  lowSleepHours: 6,
  lowSleepStreakDays: 3,
  highSorenessLevel: 4,
  /** "DOMS ≥ 4 for more than 72 h": the same muscle sore on 4 daily logs in a row. */
  sorenessStreakDays: 4,
  /** This many different signals at once bring the deload forward. */
  reactiveDeloadSignals: 2,
} as const;

/** Mesocycle and deload, SPEC §6.2 and §10.2. */
export const BLOCK_CONFIG = {
  /** Calendar days of work before the deload week. */
  workDays: 28,
  deloadDays: 7,
  /** A reactive deload never comes in the first week of a block. */
  reactiveDeloadMinDays: 7,
  /** Volume during the deload: −50%, but never below one set. */
  deloadSetFactor: 0.5,
  deloadRir: [4, 5] as [number, number],
} as const;

/** A config's shape with its literal numbers widened, so a test can pass its own values. */
export type Tunable<T> = T extends number
  ? number
  : T extends readonly [infer A, infer B]
    ? readonly [Tunable<A>, Tunable<B>]
    : T extends object
      ? { readonly [K in keyof T]: Tunable<T[K]> }
      : T;

/**
 * The day planner, SPEC §10.4 and §10.7. Daily training: 10-20 min on the
 * bike plus 20-30 min of exercises (the user's choice, 2026-10-02). Apart
 * from the volume targets in TRAINING_CONFIG these are tuning parameters.
 */
export const PLANNER_CONFIG = {
  /** Exercises only; the ride comes on top. */
  sessionMinutes: { min: 20, target: 20, max: 30 },
  maxExercisesPerSession: 6,
  setsPerExercise: 2,
  /** Sets of each light-fill and mobility exercise when the day needs filling. */
  fillerSets: 2,
  /** Light fill is practice: far from failure, so it is not a working set. */
  lightFillRir: 5,
  /**
   * Direct sets one muscle may get in a single session. Spreads the week's
   * volume over the days instead of loading it into the first one.
   */
  maxDirectSetsPerMuscleDay: 2,
  /**
   * A slot whose muscles are already on target still gets in after this
   * many days away, so no movement disappears for good (SPEC §10.4).
   */
  forceStaleDays: 10,
  /** A muscle with working sets as a primary this many days back (1 = yesterday) is recovering. */
  recoveryDays: 1,
  scoring: {
    /** Weight of the volume deficit, summed over primary muscles. */
    deficitWeight: 2,
    /** "Days since this slot was trained" counts up to this many days ... */
    stalenessCapDays: 14,
    /** ... in units of this many days. */
    stalenessUnitDays: 7,
    compoundBonus: 1,
  },
  /** Rough time per rep — a 2 s eccentric, a pause, a 1 s concentric. */
  secondsPerRep: 4,
  exerciseChangeoverSec: 30,
  bandWarmupSec: 60,
  /** Sleep under this or energy at or under that: one more rep in reserve today. */
  lowReadiness: { sleepHours: 6, energy: 2 },
  /** SPEC §8, clamp 6. */
  limits: { sets: [1, 6], reps: [1, 30], timeSec: [5, 300], rir: [0, 5] },
} as const;

export type PlannerConfig = Tunable<typeof PLANNER_CONFIG>;

/**
 * The rolling week (SPEC §11) and the requests it takes (PLAN-TYGODNIA §3.6,
 * appendix D): the numbers the engine, the calendar, the chat contract and
 * the soreness form must agree on.
 */
export const WEEK_CONFIG = {
  /** Days planned from today, today included. */
  horizonDays: 7,
  /** How far back stored days, requests and trained dates are read to bring the week up to date. */
  lookBackDays: 14,
  /** Stored days read ahead of today: wider than the horizon, so rows written under a later clock are still seen. */
  lookAheadDays: 13,
  /** A request — a soreness report or the coach's — lasts from 1 to this many days. */
  requestMaxDays: 3,
  /** The default length of a restriction: strong DOMS, and a sore muscle (a suspected strain). */
  requestDefaultDays: { strongDoms: 2, musclePain: 3 },
} as const;

/** The active session, SPEC §7.1. */
export const SESSION_CONFIG = {
  /** A session still in progress after this many hours was forgotten, not paused: it is closed on start. */
  staleAfterHours: 12,
} as const;

/** The daily ride, SPEC §7 v1.2. */
export const BIKE_CONFIG = {
  minutes: { min: 10, max: 20 },
  stepMinutes: 2,
  /** RPE at or under this is "easy". */
  easyRpe: 5,
  /** RPE at or over this is "too hard". */
  hardRpe: 8,
  /** Top of this bike's own dial, as the logging form allows it. */
  resistanceMax: 20,
} as const;

/**
 * Everything the AI layer derives from the logs before a model sees them.
 * The model comments on these; it never recomputes them.
 */
export const COACH_CONFIG = {
  /** How far back the weekly summary looks. */
  windowDays: 28,
  /** At or below this many completed sessions the trend vocabulary is off limits. PLAN §6.2. */
  sparseHistoryMaxSessions: 3,
  /** Days since the last session at which each layoff tier starts. SPEC §6.3. */
  layoffFromDays: LAYOFF_FROM_DAYS,
  /** SPEC §6.1: sleep below this for `lowSleepStreakDays` days in a row. */
  lowSleepHours: 6,
  lowSleepStreakDays: 3,
  /** Soreness level at which a muscle counts as "high". SPEC §4.3. */
  highSorenessLevel: 4,
  /**
   * Reps either way that still count as "maintained" when the load is
   * identical. In a caloric deficit holding the numbers *is* the result.
   */
  trendRepTolerance: 1,
  /** The same for isometric holds, in seconds. */
  trendTimeToleranceSec: 5,
  /** Free-text notes: how far back, how many, how long each. */
  noteWindowDays: 14,
  maxNotes: 8,
  noteMaxChars: 280,
} as const;
