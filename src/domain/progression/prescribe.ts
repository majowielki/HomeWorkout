import { PROGRESSION_CONFIG } from '../config/training';
import type { Confidence, ProgressionReason } from '../plan/reasons';
import type { Slot } from '../plan/types';
import { daysBetween } from '../time/trainingDate';
import type { BandCalibrationMap, Exercise, PlannedLoad } from '../types';
import { doubleProgression } from './doubleProgression';
import { amountOf, exposuresOf, type HistorySession, type Unit } from './history';
import { ladderFor } from './ladder';
import type { LayoffState } from './layoff';
import { loadKindOf } from './load';

/** What one exercise should be done with today, before the day-level adjustments. */
export interface Prescription {
  load: PlannedLoad;
  unit: Unit;
  /** Reps, or seconds for a hold, to aim for in the first set. */
  target: number;
  range: [number, number];
  rir: [number, number];
  /** A band exercise starts with a warm-up set (SPEC §5.6). */
  warmupSet: boolean;
  reasons: ProgressionReason[];
  confidence: Confidence;
}

export interface PrescribeInput {
  exercise: Exercise;
  slot: Slot;
  /** Completed sessions, oldest first. Other exercises' sets are ignored. */
  sessions: readonly HistorySession[];
  asOf: string;
  layoff: LayoffState;
  calibrations?: BandCalibrationMap;
}

export function unitOf(exercise: Pick<Exercise, 'forceProfile'>): Unit {
  return exercise.forceProfile === 'Isometric' ? 'sec' : 'reps';
}

/**
 * One exercise's load and target, SPEC §5.8 and §6.3:
 *
 * 1. never done → the slot's start load, bottom of the range, RIR 4
 * 2. not done for a month or more → one step lighter than last time, RIR 4
 * 3. otherwise double progression; the first sessions of an exercise still
 *    run at RIR 4
 * 4. a short layoff repeats the last session, a medium one steps down, the
 *    first sessions after a long one run at RIR 4
 *
 * Deload and today's readiness are applied later, by the day planner.
 */
export function prescribe(input: PrescribeInput, cfg = PROGRESSION_CONFIG): Prescription {
  const { exercise, slot, layoff } = input;
  const ladder = ladderFor(exercise, slot, input.calibrations);
  const unit = unitOf(exercise);
  const range =
    (unit === 'sec' ? slot.timeRange : slot.repRange) ??
    (unit === 'sec' ? cfg.fallbackTimeRange : cfg.fallbackRepRange);
  const [lo] = range;
  const isBand = loadKindOf(exercise) === 'band';
  const intro: [number, number] = [cfg.introRir, cfg.introRir];
  const base = { unit, range, warmupSet: isBand };

  const exposures = exposuresOf(exercise.id, input.sessions, ladder, unit, isBand);
  const last = exposures[exposures.length - 1];
  if (!last) {
    return {
      ...base,
      load: ladder.start,
      target: lo,
      rir: intro,
      reasons: ['FIRST_EXPOSURE'],
      confidence: 'low',
    };
  }

  if (daysBetween(last.date, input.asOf) >= cfg.reExposureAfterDays) {
    return {
      ...base,
      load: ladder.down(last.load) ?? last.load,
      target: lo,
      rir: intro,
      reasons: ['RE_EXPOSURE'],
      confidence: 'low',
    };
  }

  const step = unit === 'sec' ? cfg.timeStepSec : cfg.repStep;
  let decision = doubleProgression(exposures, ladder, {
    range,
    step,
    minRir: slot.rir[0],
    unit,
  });

  if (layoff.tier === 'short') {
    const firstAmount = amountOf(last.sets[0]!, unit)!;
    decision = {
      load: last.load,
      target: Math.min(range[1], Math.max(lo, firstAmount)),
      reasons: ['LAYOFF_SHORT'],
      confidence: 'high',
    };
  } else if (layoff.tier === 'medium') {
    decision = {
      load: ladder.down(last.load) ?? last.load,
      target: lo,
      reasons: ['LAYOFF_MEDIUM'],
      confidence: 'high',
    };
  }

  const reasons = [...decision.reasons];
  let rir: [number, number] = [slot.rir[0], slot.rir[1]];
  let confidence = decision.confidence;
  if (layoff.recalibrating) {
    reasons.push('LAYOFF_RECALIBRATION');
    rir = intro;
  } else if (exposures.length < cfg.introExposures) {
    reasons.push('INTRO_EXPOSURE');
    rir = intro;
    confidence = 'low';
  }
  if (last.warmupMissing) reasons.push('WARMUP_MISSING');

  return { ...base, load: decision.load, target: decision.target, rir, reasons, confidence };
}
