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
  'DELOAD',
  /** Overload signals: a one-legged variant was swapped for a two-legged one in its slot. */
  'BILATERAL_SWAP',
  /** Poor sleep or low energy today: one more rep in reserve (SPEC §4.3). */
  'LOW_READINESS',
  /** Light practice at RIR 5 to fill a short day; not a working set (SPEC §10.4). */
  'LIGHT_FILL',
] as const;

export type ProgressionReason = (typeof PROGRESSION_REASONS)[number];

/** Overload signals, SPEC §6.1. Two or more at once bring the deload forward. */
export const FATIGUE_SIGNALS = ['FATIGUE_HIGH', 'PERFORMANCE_DROP', 'RECOVERY_LOW'] as const;

export type FatigueSignal = (typeof FATIGUE_SIGNALS)[number];

/** What happened to the block (mesocycle) on this date, SPEC §10.2. */
export const BLOCK_EVENTS = [
  'BLOCK_STARTED',
  'BLOCK_CLOCK_RESET',
  'DELOAD_SCHEDULED',
  'DELOAD_REACTIVE',
  'BLOCK_ROTATED',
  'SELECTION_REPLACED',
] as const;

export type BlockEvent = (typeof BLOCK_EVENTS)[number];

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

/** Why a slot is not in today's plan, SPEC §10.4. */
export const SKIP_REASONS = [
  'NO_CANDIDATE',
  'DOMS_HIGH',
  'RECOVERING',
  'VOLUME_AT_MAX',
  'VOLUME_ON_TARGET',
  'ALREADY_TODAY',
  'FATIGUE_BILATERAL_ONLY',
  'NOT_PICKED',
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];

/** What shapes the whole day. */
export const DAY_REASONS = [
  'FIRST_DAY',
  'DELOAD_WEEK',
  'LAYOFF_SHORT',
  'LAYOFF_MEDIUM',
  'LAYOFF_LONG',
  'LAYOFF_RECALIBRATION',
  'LOW_READINESS',
  'LIGHT_DAY',
] as const;

export type DayReason = (typeof DAY_REASONS)[number];

/** What validatePlan changed, SPEC §8. */
export const VALIDATION_CODES = [
  'UNKNOWN_EXERCISE',
  'MEDICAL_EXCLUSION',
  'USER_EXCLUDED',
  'EXERCISE_UNAVAILABLE',
  'LOAD_NOT_AVAILABLE',
  'RANGE_CLAMPED',
  'LOAD_JUMP_CLAMPED',
  'VOLUME_TRIMMED',
  'TIME_TRIMMED',
] as const;

export type ValidationCode = (typeof VALIDATION_CODES)[number];
