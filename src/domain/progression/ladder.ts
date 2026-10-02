import { BAND_CONFIG, PROGRESSION_CONFIG } from '../config/training';
import {
  BANDS,
  type BandSpec,
  dumbbellLadder,
  isAtCeiling,
  nextRung,
  previousRung,
} from '../inventory';
import type { Confidence, ProgressionReason } from '../plan/reasons';
import type { Slot } from '../plan/types';
import type {
  AnchorPosition,
  BandCalibrationMap,
  DumbbellMode,
  Exercise,
  PlannedLoad,
} from '../types';
import { estimateBandLoad } from './calibration';
import { dumbbellModeOf, loadKindOf } from './load';

export interface LadderStep {
  load: PlannedLoad;
  reason: ProgressionReason;
  confidence: Confidence;
}

/**
 * The discrete loads one exercise can move along, SPEC §5.8. Dumbbells
 * step by rung, bands by position and then by band, bodyweight has a
 * single rung. Progression logic only ever talks to this interface, which
 * is why it is the same algorithm for all three.
 */
export interface LoadLadder {
  /** Heavier is higher; null when the load is not on this ladder (another kind or mode). */
  rank(load: PlannedLoad): number | null;
  /** One step heavier, or null at the ceiling. */
  up(load: PlannedLoad): LadderStep | null;
  /** One step lighter, or null at the floor. */
  down(load: PlannedLoad): PlannedLoad | null;
  /**
   * The load itself when the equipment can make it, the nearest lighter
   * one it can make otherwise, null when it does not belong on this ladder.
   */
  snap(load: PlannedLoad): PlannedLoad | null;
  /** What `up` returning null means for this ladder. */
  ceilingReason: ProgressionReason;
  /** Where a never-done exercise begins. */
  start: PlannedLoad;
}

export function dumbbellLoadLadder(mode: DumbbellMode, startKg: number): LoadLadder {
  const rungs = dumbbellLadder(mode);
  const kgOf = (load: PlannedLoad) =>
    load.kind === 'dumbbell' && load.mode === mode ? load.kg : null;
  return {
    rank: kgOf,
    up(load) {
      const kg = kgOf(load);
      if (kg === null || isAtCeiling(rungs, kg)) return null;
      return {
        load: { kind: 'dumbbell', mode, kg: nextRung(rungs, kg) },
        reason: 'REP_TARGET_MET',
        confidence: 'high',
      };
    },
    down(load) {
      const kg = kgOf(load);
      if (kg === null || kg <= rungs[0]!) return null;
      return { kind: 'dumbbell', mode, kg: previousRung(rungs, kg) };
    },
    snap(load) {
      const kg = kgOf(load);
      if (kg === null) return null;
      if (rungs.includes(kg)) return load;
      return { kind: 'dumbbell', mode, kg: [...rungs].reverse().find((r) => r < kg) ?? rungs[0]! };
    },
    ceilingReason: 'LOAD_CEILING_REACHED',
    start: { kind: 'dumbbell', mode, kg: startKg },
  };
}

const POSITIONS = 4;

/**
 * Bands in the order of the inventory (lightest first) × anchor positions
 * P0-P3. Micro progression moves one position out; from P3 a macro step
 * goes to the next band at P1 — or at P0 when the jump in force cannot be
 * estimated or exceeds 15% (SPEC §5.4). The green band is uncalibratable
 * by design, so a step onto it always lands on P0.
 */
export function bandLoadLadder(
  startBandId: string,
  romCm: number,
  calibrations: BandCalibrationMap = {},
  bands: readonly BandSpec[] = BANDS,
  cfg = PROGRESSION_CONFIG,
): LoadLadder {
  const indexOf = (id: string) => bands.findIndex((b) => b.id === id);
  const at = (index: number, position: AnchorPosition): PlannedLoad => ({
    kind: 'band',
    bandId: bands[index]!.id,
    position,
  });
  const peakKg = (bandId: string, position: AnchorPosition) => {
    const estimate = estimateBandLoad(calibrations[bandId] ?? null, position, romCm);
    return estimate.kind === 'range' ? estimate.maxKg : null;
  };

  return {
    rank(load) {
      if (load.kind !== 'band') return null;
      const index = indexOf(load.bandId);
      return index === -1 ? null : index * POSITIONS + load.position;
    },
    up(load) {
      if (load.kind !== 'band') return null;
      const index = indexOf(load.bandId);
      if (index === -1) return null;
      if (load.position < 3) {
        return {
          load: at(index, (load.position + 1) as AnchorPosition),
          reason: 'BAND_MICRO_PROGRESSION',
          confidence: 'high',
        };
      }
      const next = bands[index + 1];
      if (!next) return null;
      const from = peakKg(load.bandId, 3);
      const to = peakKg(next.id, 1);
      const measurable = from !== null && to !== null && from > 0;
      const gentle = measurable && to / from - 1 <= cfg.bandMacroMaxJump;
      return {
        load: at(index + 1, gentle ? 1 : 0),
        reason: 'BAND_MACRO_PROGRESSION',
        confidence: measurable ? 'high' : 'low',
      };
    },
    down(load) {
      if (load.kind !== 'band') return null;
      const index = indexOf(load.bandId);
      if (index === -1) return null;
      if (load.position > 0) return at(index, (load.position - 1) as AnchorPosition);
      return index > 0 ? at(index - 1, 3) : null;
    },
    snap(load) {
      return load.kind === 'band' && indexOf(load.bandId) !== -1 ? load : null;
    },
    ceilingReason: 'LOAD_CEILING_REACHED',
    start: {
      kind: 'band',
      bandId: indexOf(startBandId) === -1 ? bands[0]!.id : startBandId,
      position: cfg.bandStartPosition,
    },
  };
}

export const BODYWEIGHT_LADDER: LoadLadder = {
  rank: (load) => (load.kind === 'bodyweight' ? 0 : null),
  up: () => null,
  down: () => null,
  snap: (load) => (load.kind === 'bodyweight' ? load : null),
  ceilingReason: 'BODYWEIGHT_CEILING',
  start: { kind: 'bodyweight' },
};

/** The ladder an exercise moves on, started where its slot says. */
export function ladderFor(
  exercise: Exercise,
  slot: Slot,
  calibrations?: BandCalibrationMap,
): LoadLadder {
  const kind = loadKindOf(exercise);
  if (kind === 'band') {
    return bandLoadLadder(
      slot.start.band ?? BANDS[0]!.id,
      BAND_CONFIG.romCm[exercise.movementPattern],
      calibrations,
    );
  }
  if (kind === 'dumbbell') {
    const mode = dumbbellModeOf(exercise);
    return dumbbellLoadLadder(mode, slot.start[mode] ?? dumbbellLadder(mode)[0]!);
  }
  return BODYWEIGHT_LADDER;
}
