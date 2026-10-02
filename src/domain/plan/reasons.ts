/**
 * Why the engine decided what it decided — codes, never sentences
 * (SPEC §1.2). The UI maps each to Polish copy through an exhaustive
 * record, and the AI layer receives them as facts. Lists rather than bare
 * unions so a contract can enumerate them with `z.enum`.
 */

/** Why an exercise carries the load and target it does. */
export const PROGRESSION_REASONS = [
  'FIRST_EXPOSURE',
  'INTRO_EXPOSURE',
  'RE_EXPOSURE',
  'REP_TARGET_MET',
  'BAND_MICRO_PROGRESSION',
  'BAND_MACRO_PROGRESSION',
  'LOAD_CEILING_REACHED',
  'BODYWEIGHT_CEILING',
  'PERFORMANCE_REGRESSION',
  'REP_PROGRESSION',
  'RIR_BELOW_TARGET',
  'WARMUP_MISSING',
  'LAYOFF_SHORT',
  'LAYOFF_MEDIUM',
  'LAYOFF_RECALIBRATION',
] as const;

export type ProgressionReason = (typeof PROGRESSION_REASONS)[number];

/** Why the bike is set the way it is. */
export const BIKE_REASONS = [
  'FIRST_EXPOSURE',
  'BIKE_TIME_UP',
  'BIKE_RESISTANCE_UP',
  'BIKE_EASE_OFF',
  'BIKE_HOLD',
  'LAYOFF_MEDIUM',
  'LAYOFF_LONG',
] as const;

export type BikeReason = (typeof BIKE_REASONS)[number];

export type Confidence = 'high' | 'low';
