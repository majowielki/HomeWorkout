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
 * Volume profiles and preferences (13 §2, steps 2 and 7) join with P1/P3.
 */

import { PLANNER_CONFIG, type PlannerConfig, TRAINING_CONFIG } from '../config/training';
import { scaledConfig, TRAIN_DAILY, type TrainingWeek } from '../plan/constraints';

export type PlanIntent = 'auto_day' | 'extra' | 'compose' | 'template' | 'session_change';

/** The numbers a day is chosen and built from. */
export interface PolicyBase {
  planner: PlannerConfig;
  training: typeof TRAINING_CONFIG;
}

export interface DayPolicy extends PolicyBase {
  intent: PlanIntent;
}

export const BASE_POLICY: PolicyBase = { planner: PLANNER_CONFIG, training: TRAINING_CONFIG };

/** Intents that take the movements somebody asked for instead of filling a time budget. */
const EXPLICIT: ReadonlySet<PlanIntent> = new Set(['extra', 'compose', 'session_change']);

export function resolveDayPolicy(
  base: PolicyBase,
  week: TrainingWeek | undefined,
  intent: PlanIntent,
): DayPolicy {
  const scaled = scaledConfig(week ?? TRAIN_DAILY, base.planner);
  if (!EXPLICIT.has(intent)) return { ...base, planner: scaled, intent };
  const { max } = scaled.sessionMinutes;
  return {
    ...base,
    intent,
    planner: {
      ...scaled,
      // An explicit choice can exceed the weekly target, never the maximum.
      forceStaleDays: 0,
      sessionMinutes: { min: 0, target: max, max },
    },
  };
}
