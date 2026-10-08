/**
 * The week ahead, SPEC §11 (Documents/PLAN-TYGODNIA-I-POPRAWKI.md §3.9).
 *
 * Day by day, like the simulation: each day is chosen from the logs plus
 * the days before it done as planned, so Thursday already counts Tuesday's
 * sets. What is stored is the choice — slots, exercises, sets — never the
 * loads: those come when the day is built from the logs as they are then.
 *
 * A day chosen earlier stays as it was as long as it still passes the
 * planner's own rules (`checkSelection`): the plan is firm, and changes
 * only where it has to.
 */

import { fatigueSignals } from '../autoregulation/fatigue';
import { PLANNER_CONFIG, type PlannerConfig, TRAINING_CONFIG } from '../config/training';
import type { Ride } from '../progression/bike';
import type { HistorySession } from '../progression/history';
import type { BandCalibrationMap, Exercise, MuscleGroup } from '../types';
import { advanceBlock } from './block';
import { resolveDayPolicy } from '../policy/dayPolicy';
import { composeDay, type DayOption, dayOptions } from './compose';
import {
  composedOn,
  dateRange,
  isTrainingDay,
  type PlanConstraint,
  TRAIN_DAILY,
  type TrainingWeek,
} from './constraints';
import { buildDay, checkSelection, directVolume, type PlannerInput, selectDay } from './dayPlanner';
import { type EligibilityContext, slotByExercise } from './eligibility';
import type { BlockEvent } from './reasons';
import { FOLLOWS_THE_PLAN, perform } from './simulate';
import type {
  BlockState,
  DailyReadiness,
  DaySelection,
  SelectionViolation,
  SessionPlan,
  Slot,
} from './types';

export interface WeekInput {
  /** The first day to plan. */
  from: string;
  days: number;
  catalog: Readonly<Record<string, Exercise>>;
  slots: readonly Slot[];
  eligibility: EligibilityContext;
  /** The stored block as last advanced (on or before `from`); null before the first one. */
  block: BlockState | null;
  /** Completed sessions, oldest first — real ones only. */
  sessions: readonly HistorySession[];
  lastSessionDate: string | null;
  rides: readonly Ride[];
  daily: readonly DailyReadiness[];
  calibrations?: BandCalibrationMap;
  constraints?: readonly PlanConstraint[];
  /** Which weekdays rest; every day trains when absent. */
  week?: TrainingWeek;
  /** Days chosen earlier, by date; each stays while it still passes `checkSelection`. */
  kept?: Readonly<Record<string, DaySelection>>;
  /** A date whose options for composing the day (ADR 0006) the caller wants. */
  optionsFor?: string;
}

export interface WeekDay {
  date: string;
  /** A rest day: from the weekly pattern or asked for. */
  rest: boolean;
  /** What to train; null on a rest day. */
  selection: DaySelection | null;
  /** The day as it would be built if everything before it goes as planned — a forecast. */
  forecast: SessionPlan | null;
  /** kept: as chosen earlier; changed: chosen earlier but no longer holds; new: not chosen before. */
  status: 'kept' | 'changed' | 'new';
  /** Why a day chosen earlier was chosen again. */
  violations: SelectionViolation[];
  /** What happens to the block that day (rotation, deload). */
  events: BlockEvent[];
  /** The day's movements were composed with the coach (a `compose_day` request). */
  composed: boolean;
  /** The movements the coach may compose the day from; only for `optionsFor`. */
  options?: DayOption[];
}

export interface WeekPlan {
  from: string;
  days: WeekDay[];
  /** Direct working sets per muscle over the 7 days ending on the last day, the plan done. */
  volume: Record<MuscleGroup, number>;
}

export function planWeek(
  input: WeekInput,
  cfg: PlannerConfig = PLANNER_CONFIG,
  training = TRAINING_CONFIG,
): WeekPlan {
  const { catalog, slots, eligibility } = input;
  const constraints = input.constraints ?? [];
  const week = input.week ?? TRAIN_DAILY;
  const base = { planner: cfg, training };
  const autoPolicy = resolveDayPolicy(base, week, 'auto_day');
  const composePolicy = resolveDayPolicy(base, week, 'compose');
  const slotOf = slotByExercise(slots);
  const sessions = [...input.sessions];
  const rides = [...input.rides];
  let block = input.block;
  let lastSessionDate = input.lastSessionDate;
  const days: WeekDay[] = [];

  for (const date of dateRange(input.from, input.days)) {
    const signals = fatigueSignals({ asOf: date, sessions, catalog, slotOf, daily: input.daily });
    const advance = advanceBlock(block, {
      asOf: date,
      lastSessionDate,
      signals,
      slots,
      catalog,
      eligibility,
    });
    block = advance.block;
    const stored = input.kept?.[date];

    if (!isTrainingDay(date, week, constraints)) {
      days.push({
        date,
        rest: true,
        selection: null,
        forecast: null,
        status: stored ? 'changed' : 'new',
        violations: stored ? [{ slotId: null, code: 'REST_DAY' }] : [],
        events: advance.events,
        composed: false,
      });
      continue;
    }

    const day: PlannerInput = {
      asOf: date,
      catalog,
      slots,
      eligibility,
      block,
      sessions,
      rides,
      daily: input.daily,
      calibrations: input.calibrations,
      constraints,
      week,
    };
    // A composed day comes first; what the engine could not take is reported, and an
    // empty composition gives the day back to the engine (ADR 0006).
    const items = composedOn(constraints, date);
    const composition = items ? composeDay(day, items, composePolicy) : null;
    const composedSelection =
      composition && composition.selection.items.length > 0 ? composition.selection : null;
    const violations = composition
      ? composition.conflicts.map((c) => ({ slotId: c.slotId, code: c.reason }))
      : stored
        ? checkSelection(stored, day, autoPolicy.planner, autoPolicy.training)
        : [];
    const selection =
      composedSelection ??
      (!composition && stored && violations.length === 0
        ? stored
        : selectDay(day, autoPolicy.planner, autoPolicy.training));
    const forecast = buildDay(selection, day, autoPolicy.planner, autoPolicy.training);
    days.push({
      date,
      rest: false,
      selection,
      forecast,
      status: !stored ? 'new' : violations.length > 0 ? 'changed' : 'kept',
      violations,
      events: advance.events,
      composed: composedSelection !== null,
      ...(input.optionsFor === date ? { options: dayOptions(day, composePolicy) } : {}),
    });

    sessions.push({ date, sets: perform(forecast, FOLLOWS_THE_PLAN, catalog) });
    rides.push({
      date,
      minutes: forecast.bike.minutes,
      resistance: forecast.bike.resistance ?? 3,
      rpe: 5,
    });
    lastSessionDate = date;
  }

  const lastDay = days[days.length - 1]?.date ?? input.from;
  return { from: input.from, days, volume: directVolume(sessions, catalog, lastDay, training) };
}
