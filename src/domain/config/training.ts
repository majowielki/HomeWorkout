/**
 * Every tunable number the rules engine uses, in one place — separate from
 * the logic so it can be adjusted against the body's actual response
 * without touching an algorithm. See SPEC-silnik-regul.md §1.3 and
 * PLAN.md §10.1 for why these values are expected to drift.
 */

import type { MovementPattern } from '../types';

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
  /** Above this jump in estimated force, a new band starts at P0, not P1. SPEC §5.4. */
  bandMacroMaxJump: 0.15,
  /** Used only when a slot lacks the range a candidate needs (the data check prevents it). */
  fallbackRepRange: [8, 15] as [number, number],
  fallbackTimeRange: [20, 60] as [number, number],
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
