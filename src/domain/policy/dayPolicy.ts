/**
 * One effective configuration for one day (engine, 13 §2).
 *
 * Every way of building a day — the engine's own choice, an extra session,
 * a day composed with the coach, a manual template, a change during a session
 * — used to take its numbers from wherever was handy: the week planner scaled
 * the session length for the days that train, while `selectCustom` read the
 * global `PLANNER_CONFIG` and so ignored both the scaling and any other
 * config the caller had passed. `resolveDayPolicy` is the single place that
 * layers the settings, so the same budget and limits reach every path and
 * only the differences of *intent* are visible and named.
 *
 * Layers, each narrowing the one before it:
 *  1. the base configuration the caller supplies,
 *  2. the weekly pattern: fewer training days give a longer session target,
 *  3. the intent: an explicit request (extra, compose, session change) may
 *     exceed the weekly target but never the maximum, and ignores staleness.
 *
 * Phase (deload), readiness and the person's requests for the day are read
 * by the planner from the block and the logs, so they are not layered here.
 * The weekly volume profile and the person's own maxima (13 §2, step 2) are laid on the base first;
 * the sets per exposure are the planner's own reading of the preferences.
 */

import {
  HIGHER_VOLUME,
  PLANNER_CONFIG,
  type PlannerConfig,
  TRAINING_CONFIG,
  type TrainingConfig,
  type WeeklySets,
} from '../config/training';
import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { scaledConfig, TRAIN_DAILY, type TrainingWeek } from '../plan/constraints';
import type { TrainingPreferences } from '../preferences/preferences';
import type { MuscleGroup } from '../types';

export type PlanIntent = 'auto_day' | 'extra' | 'compose' | 'template' | 'session_change';

/** The numbers a day is chosen and built from. */
export interface PolicyBase {
  planner: PlannerConfig;
  training: TrainingConfig;
}

export interface DayPolicy extends PolicyBase {
  intent: PlanIntent;
}

export const BASE_POLICY: PolicyBase = { planner: PLANNER_CONFIG, training: TRAINING_CONFIG };

/** Intents that take the movements somebody asked for instead of filling a time budget. */
const EXPLICIT: ReadonlySet<PlanIntent> = new Set(['extra', 'compose', 'session_change']);

/** What of the preferences the weekly volume reads. */
export type VolumePreferences = Pick<TrainingPreferences, 'volumeProfile' | 'volumeOverrides'>;

/** The weekly sets of a muscle the planner aims for and may not pass: the profile, then the person's own maxima. */
export interface VolumeTargets {
  weekly: WeeklySets;
  maxOf: (muscle: MuscleGroup) => number;
  training: TrainingConfig;
}

export function volumeTargets(
  prefs: VolumePreferences | undefined,
  base: TrainingConfig = TRAINING_CONFIG,
): VolumeTargets {
  const weekly =
    prefs?.volumeProfile === 'higher' ? HIGHER_VOLUME : base.weeklyWorkingSetsPerMuscle;
  const own = prefs?.volumeOverrides ?? {};
  // A muscle that several slots train has a higher maximum of its own, never below the profile's.
  const maxDirectSetsOverride = Object.fromEntries(
    MUSCLE_GROUPS.flatMap((m) => {
      const max = own[m] ?? Math.max(base.maxDirectSetsOverride[m] ?? 0, weekly.max);
      return max === weekly.max ? [] : [[m, max] as const];
    }),
  ) as Partial<Record<MuscleGroup, number>>;
  return {
    weekly,
    maxOf: (m) => maxDirectSetsOverride[m] ?? weekly.max,
    training: { ...base, weeklyWorkingSetsPerMuscle: weekly, maxDirectSetsOverride },
  };
}

export function resolveDayPolicy(
  base: PolicyBase,
  week: TrainingWeek | undefined,
  intent: PlanIntent,
  prefs?: VolumePreferences,
): DayPolicy {
  const scaled = scaledConfig(week ?? TRAIN_DAILY, base.planner);
  const training = volumeTargets(prefs, base.training).training;
  if (!EXPLICIT.has(intent)) return { ...base, training, planner: scaled, intent };
  const { max } = scaled.sessionMinutes;
  return {
    ...base,
    training,
    intent,
    planner: {
      ...scaled,
      // An explicit choice can exceed the weekly target, never the maximum.
      forceStaleDays: 0,
      sessionMinutes: { min: 0, target: max, max },
    },
  };
}
