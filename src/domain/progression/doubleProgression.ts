import type { Confidence, ProgressionReason } from '../plan/reasons';
import type { PlannedLoad } from '../types';
import { amountOf, type Exposure, type Unit } from './history';
import type { LoadLadder } from './ladder';

export interface ProgressionDecision {
  load: PlannedLoad;
  /** Reps (or seconds) to aim for in the first set. */
  target: number;
  reasons: ProgressionReason[];
  confidence: Confidence;
}

export interface DoubleProgressionParams {
  range: readonly [number, number];
  step: number;
  /** Lower bound of the target RIR: a set that hit the top with less in reserve was a grind. */
  minRir: number;
  unit: Unit;
}

/**
 * Every set at the top of the range, none of them a grind (RIR at or above
 * the lower target). A missing RIR does not block: the logger always
 * records one, so an empty field is old data. The condition for a step up.
 */
export function targetMet(
  exposure: Exposure,
  params: Pick<DoubleProgressionParams, 'range' | 'minRir' | 'unit'>,
): boolean {
  return exposure.sets.every(
    (s) =>
      amountOf(s, params.unit)! >= params.range[1] && (s.rir === null || s.rir >= params.minRir),
  );
}

/**
 * SPEC §5.1 over any ladder (§5.8). Reads the last exposure, and the one
 * before it for the regression rule:
 *
 * - every set at the top of the range with RIR in target → one step up the
 *   ladder and back to the bottom of the range; at the ceiling, stay on top
 * - a set below the range in both of the last two exposures at this load →
 *   one step down, bottom of the range. With no lighter step (bodyweight, the
 *   lightest dumbbell or band) nothing changes, so no step down is reported:
 *   the exposure is treated like any other below the top of the range
 * - otherwise the same load and one more rep (or 5 s) in the first set that
 *   did not reach the top
 */
export function doubleProgression(
  exposures: readonly Exposure[],
  ladder: LoadLadder,
  params: DoubleProgressionParams,
): ProgressionDecision {
  const [lo, hi] = params.range;
  const last = exposures[exposures.length - 1]!;
  const amounts = last.sets.map((s) => amountOf(s, params.unit)!);

  const allAtTop = amounts.every((a) => a >= hi);

  if (targetMet(last, params)) {
    const up = ladder.up(last.load);
    if (up) return { load: up.load, target: lo, reasons: [up.reason], confidence: up.confidence };
    return { load: last.load, target: hi, reasons: [ladder.ceilingReason], confidence: 'high' };
  }

  const previous = exposures[exposures.length - 2];
  const belowNow = amounts.some((a) => a < lo);
  const belowBefore =
    previous !== undefined &&
    ladder.rank(previous.load) === ladder.rank(last.load) &&
    previous.sets.some((s) => amountOf(s, params.unit)! < lo);
  const lighter = ladder.down(last.load);
  if (belowNow && belowBefore && lighter) {
    return { load: lighter, target: lo, reasons: ['PERFORMANCE_REGRESSION'], confidence: 'high' };
  }

  if (allAtTop) {
    return { load: last.load, target: hi, reasons: ['RIR_BELOW_TARGET'], confidence: 'high' };
  }

  const firstShort = amounts.find((a) => a < hi)!;
  const target = Math.min(hi, Math.max(lo, firstShort + params.step));
  return { load: last.load, target, reasons: ['REP_PROGRESSION'], confidence: 'high' };
}
