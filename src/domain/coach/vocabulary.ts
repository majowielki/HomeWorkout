import type { MuscleGroup } from '../types';

/**
 * Runtime lists behind the types the AI contract needs as `z.enum` values.
 * A test pins each list to its type, so adding a member to the type without
 * adding it here fails `tsc`.
 */
export const MUSCLE_GROUPS = [
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'chest',
  'back',
  'lats',
  'shoulders',
  'biceps',
  'triceps',
  'core',
  'forearms',
] as const satisfies readonly MuscleGroup[];

/**
 * Facts derived from the logs in code and handed to the model as codes
 * (SPEC §1.2). The rules engine adds its own later (`FATIGUE_HIGH`,
 * `PERFORMANCE_DROP`, ...) together with a contract version bump.
 */
export const SIGNAL_CODES = [
  'SPARSE_HISTORY',
  'LAYOFF_SHORT',
  'LAYOFF_MEDIUM',
  'LAYOFF_LONG',
  'SLEEP_LOW_STREAK',
] as const;

export type SignalCode = (typeof SIGNAL_CODES)[number];

/**
 * Knee limits as constraint codes. The model hears what the limits are,
 * never the diagnosis behind them (AI-INTEGRACJA §4.8).
 */
export const CONSTRAINT_CODES = [
  'knee_no_frontal_plane_under_load',
  'knee_limit_anterior_shear',
  'knee_bilateral_only_until_physio',
] as const;

export type ConstraintCode = (typeof CONSTRAINT_CODES)[number];

export const TREND_VERDICTS = [
  'improved',
  'maintained',
  'declined',
  'not_comparable',
  'insufficient_data',
] as const;

export type TrendVerdict = (typeof TREND_VERDICTS)[number];

export const VOLUME_STATUSES = ['below_min', 'in_range', 'above_max'] as const;

export type VolumeStatus = (typeof VOLUME_STATUSES)[number];
