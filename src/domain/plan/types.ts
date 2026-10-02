/**
 * Vocabulary of the daily planner (SPEC-silnik-regul.md §10).
 *
 * A slot names a movement — "horizontal push", "hinge", "calves" — not an
 * exercise. Each block (mesocycle) fills every slot with one exercise from
 * its ordered candidate list, and the next block moves on to the next one.
 * That is what keeps the whole body trained over months without the same
 * twelve exercises on repeat.
 */

import type { BikePrescription } from '../progression/bike';
import type { Unit } from '../progression/history';
import type { MuscleGroup, PlannedLoad, TemplateBlock } from '../types';
import type {
  Confidence,
  DayReason,
  FatigueSignal,
  ProgressionReason,
  SkipReason,
  ValidationCode,
} from './reasons';

export type SlotKind = 'compound' | 'accessory' | 'core' | 'filler';

export type SlotRegion = 'lower' | 'push' | 'pull' | 'shoulders' | 'arms' | 'core' | 'mobility';

/** Where a never-done exercise starts. Guesses, not research — SPEC §5.8. */
export interface SlotStart {
  /** Kilograms per hand on the paired ladder. */
  paired?: number;
  /** Kilograms on one bar, single ladder. */
  single?: number;
  /** Band id; the anchor position comes from the config. */
  band?: string;
}

export interface Slot {
  id: string;
  /** Polish, shown in the UI. */
  name: string;
  kind: SlotKind;
  region: SlotRegion;
  /** Candidates in rotation order, easier first. */
  exerciseIds: string[];
  /** Required when a candidate is counted in reps. */
  repRange?: [number, number];
  /** Required when a candidate is isometric (held for seconds). */
  timeRange?: [number, number];
  rir: [number, number];
  restSec: number;
  start: SlotStart;
  /**
   * On a short day, the block's exercise of this slot may top the session
   * up as light work at RIR 5 — practice that does not count as a working
   * set (SPEC §4.2). Core and rotator-cuff slots.
   */
  lightFill?: boolean;
}

/** One morning's entry of the daily log, as the engine reads it. */
export interface DailyReadiness {
  date: string;
  sleepHours: number | null;
  /** 1-5. */
  energy: number | null;
  /** DOMS per muscle, 1-5; absent muscles are not sore. */
  soreness: Partial<Record<MuscleGroup, number>> | null;
}

/**
 * A block (mesocycle): one exercise per slot for its whole length, so
 * double progression has something to compare; the next block rotates
 * every slot to its next candidate. Only what must survive a restart is
 * stored — the phase follows from the dates.
 */
export interface BlockState {
  /** 1 for the first block ever. */
  index: number;
  /** When the work weeks started counting; a layoff moves it (BLOCK_CLOCK_RESET). */
  startedOn: string;
  /** First day of the deload week, once decided. */
  deloadFrom: string | null;
  deloadReason: 'DELOAD_SCHEDULED' | 'DELOAD_REACTIVE' | null;
  /** slotId → exerciseId. A slot with no allowed candidate has no entry. */
  selections: Record<string, string>;
}

/**
 * One exercise of a day's plan. It is a `TemplateBlock`, so the active
 * session runs it exactly like a template; the rest says what to load and
 * why. For a hold, `timeSec` is the target; for reps, `repMin`/`repMax` is
 * the range and `target` the reps to aim for in the first set.
 */
export interface PlannedExercise extends TemplateBlock {
  slotId: string;
  load: PlannedLoad;
  unit: Unit;
  target: number;
  /** Start with a warm-up set (bands, SPEC §5.6). */
  warmupSet: boolean;
  reasons: ProgressionReason[];
  confidence: Confidence;
}

/** A slot that is not in the plan today, and why — "why no squats today?". */
export interface SkippedSlot {
  slotId: string;
  /** The block's exercise for the slot; null when it has none. */
  exerciseId: string | null;
  reason: SkipReason;
}

/** Something validatePlan changed. */
export interface PlanAdjustment {
  exerciseId: string;
  code: ValidationCode;
}

/** The plan for one day, SPEC §10.5. Frozen into `workouts.plan` when the session starts. */
export interface SessionPlan {
  version: 1;
  date: string;
  blockIndex: number;
  phase: 'work' | 'deload';
  /** Regions of the hard work, most sets first — the day's title. */
  regions: SlotRegion[];
  bike: BikePrescription;
  exercises: PlannedExercise[];
  skipped: SkippedSlot[];
  dayReasons: DayReason[];
  signals: FatigueSignal[];
  /** Exercises only; the ride comes on top. */
  estimatedMinutes: number;
  adjustments: PlanAdjustment[];
}
