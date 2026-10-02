import { fatigueSignals } from '../autoregulation/fatigue';
import type { Ride } from '../progression/bike';
import type { HistorySession } from '../progression/history';
import type { BandCalibrationMap, Exercise, MuscleGroup } from '../types';
import { advanceBlock, type BlockAdvance } from './block';
import { directVolume, planDay } from './dayPlanner';
import { type EligibilityContext, slotByExercise } from './eligibility';
import type { BlockState, DailyReadiness, SessionPlan, Slot } from './types';

export interface TodayInput {
  asOf: string;
  catalog: Readonly<Record<string, Exercise>>;
  slots: readonly Slot[];
  eligibility: EligibilityContext;
  /** The stored open block, or null before the first one. */
  block: BlockState | null;
  /** Completed sessions, oldest first. */
  sessions: readonly HistorySession[];
  /** Training date of the latest completed session ever, older than `sessions` may reach. */
  lastSessionDate: string | null;
  rides: readonly Ride[];
  daily: readonly DailyReadiness[];
  calibrations?: BandCalibrationMap;
}

export interface Today {
  /** What to store: the block moved to today. */
  advance: BlockAdvance;
  plan: SessionPlan;
  /** Direct working sets per muscle over the last 7 days, for the volume meter. */
  volume: Record<MuscleGroup, number>;
}

/**
 * Everything the "today" screen needs, from plain data: the overload
 * signals, the block moved to today (rotation, deload, a restarted clock)
 * and the day's plan from that block. Pure, so the screen's logic is the
 * engine's and is tested with it; the caller stores `advance` and shows
 * `plan`.
 */
export function planToday(input: TodayInput): Today {
  const signals = fatigueSignals({
    asOf: input.asOf,
    sessions: input.sessions,
    catalog: input.catalog,
    slotOf: slotByExercise(input.slots),
    daily: input.daily,
  });
  const advance = advanceBlock(input.block, {
    asOf: input.asOf,
    lastSessionDate: input.lastSessionDate,
    signals,
    slots: input.slots,
    catalog: input.catalog,
    eligibility: input.eligibility,
  });
  const plan = planDay({
    asOf: input.asOf,
    catalog: input.catalog,
    slots: input.slots,
    eligibility: input.eligibility,
    block: advance.block,
    sessions: input.sessions,
    rides: input.rides,
    daily: input.daily,
    calibrations: input.calibrations,
  });
  return {
    advance,
    plan,
    volume: directVolume(input.sessions, input.catalog, input.asOf),
  };
}
