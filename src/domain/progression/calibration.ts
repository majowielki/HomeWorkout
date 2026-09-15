/**
 * Turning a resistance band into something with a number on it.
 *
 * A band has no mass, only a force that grows with stretch. Calibration
 * hangs known masses from it, measures the length each one produces and
 * fits force as a function of stretch ratio λ = L / L0. The dumbbells cap
 * the procedure at 18 kg, so the heaviest band never gets a curve and the
 * fit may cover only the bottom of another's range — every consumer has to
 * live with `fit === null` and with `maxMeasuredKg` as a hard ceiling.
 * See SPEC-silnik-regul.md §5.5.
 */

import { BAND_CONFIG } from '../config/training';
import type { AnchorPosition, BandCalibration, BandCalibrationPoint } from '../types';

export type CalibrationReason =
  | 'FIT_LINEAR'
  | 'FIT_QUADRATIC'
  /** Fewer than BAND_CONFIG.minCalibrationPoints measurements. */
  | 'TOO_FEW_POINTS'
  /** The lengths do not vary with mass — the masses on hand cannot bend this band. */
  | 'NO_STRETCH';

export interface CalibrationResult {
  calibration: BandCalibration;
  reason: CalibrationReason;
  /** Coefficient of determination of the chosen fit; null when there is none. */
  r2: number | null;
}

type Fit = NonNullable<BandCalibration['fit']>;

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function rSquared(ys: number[], predicted: number[]): number {
  const yBar = mean(ys);
  const ssTot = ys.reduce((s, y) => s + (y - yBar) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - (predicted[i] as number)) ** 2, 0);
  // A constant y is reproduced exactly by any model with an intercept.
  if (ssTot === 0) return 1;
  return 1 - ssRes / ssTot;
}

/** Ordinary least squares y = a + b·x. Null when every x is the same. */
function linearFit(xs: number[], ys: number[]): { coeffs: number[]; r2: number } | null {
  const xBar = mean(xs);
  const yBar = mean(ys);
  const sxx = xs.reduce((s, x) => s + (x - xBar) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = xs.reduce((s, x, i) => s + (x - xBar) * ((ys[i] as number) - yBar), 0);
  const b = sxy / sxx;
  const a = yBar - b * xBar;
  const coeffs = [a, b];
  return {
    coeffs,
    r2: rSquared(
      ys,
      xs.map((x) => evaluate({ type: 'linear', coeffs }, x)),
    ),
  };
}

/**
 * Solves A·x = b for a 3×3 system by Gauss–Jordan elimination; null when
 * singular. No pivoting: the normal-equations matrix is symmetric positive
 * semi-definite, for which elimination in natural order is stable.
 */
function solve3(a: number[][], b: number[]): number[] | null {
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let col = 0; col < 3; col += 1) {
    const row = m[col] as number[];
    if (Math.abs(row[col] as number) < 1e-9) return null;
    for (let r = 0; r < 3; r += 1) {
      if (r === col) continue;
      const target = m[r] as number[];
      const factor = (target[col] as number) / (row[col] as number);
      for (let c = col; c < 4; c += 1) {
        target[c] = (target[c] as number) - factor * (row[c] as number);
      }
    }
  }
  // Gauss–Jordan leaves the matrix diagonal, so each unknown reads off its row.
  return m.map((row, i) => (row[3] as number) / (row[i] as number));
}

/** Least squares y = a + b·x + c·x² via the normal equations. */
function quadraticFit(xs: number[], ys: number[]): { coeffs: number[]; r2: number } | null {
  const s = (p: number) => xs.reduce((acc, x) => acc + x ** p, 0);
  const sy = (p: number) => xs.reduce((acc, x, i) => acc + x ** p * (ys[i] as number), 0);
  const coeffs = solve3(
    [
      [xs.length, s(1), s(2)],
      [s(1), s(2), s(3)],
      [s(2), s(3), s(4)],
    ],
    [sy(0), sy(1), sy(2)],
  );
  if (!coeffs) return null;
  return {
    coeffs,
    r2: rSquared(
      ys,
      xs.map((x) => evaluate({ type: 'quadratic', coeffs }, x)),
    ),
  };
}

/** Force (as kg-equivalent) predicted at stretch ratio λ. */
export function evaluate(fit: Fit, lambda: number): number {
  const a = fit.coeffs[0] as number;
  const b = fit.coeffs[1] as number;
  if (fit.type === 'linear') return a + b * lambda;
  return a + b * lambda + (fit.coeffs[2] as number) * lambda * lambda;
}

/**
 * Fits F(λ) to the measured points. Linear when it explains the data well
 * enough, quadratic otherwise; no fit at all with too few points or when
 * the band did not stretch. The points are stored regardless so the
 * wizard can be resumed and the fit recomputed with a changed config.
 */
export function fitCalibration(
  restLengthCm: number,
  points: readonly BandCalibrationPoint[],
  cfg = BAND_CONFIG,
): CalibrationResult {
  if (!(restLengthCm > 0))
    throw new RangeError(`restLengthCm must be positive, got ${restLengthCm}`);
  for (const p of points) {
    if (!(p.massKg > 0) || !(p.lengthCm >= restLengthCm)) {
      throw new RangeError(`invalid calibration point ${JSON.stringify(p)} for L0=${restLengthCm}`);
    }
  }

  const sorted = [...points].sort((a, b) => a.massKg - b.massKg);
  const base: BandCalibration = {
    restLengthCm,
    points: sorted,
    fit: null,
    maxMeasuredKg:
      sorted.length > 0 ? (sorted[sorted.length - 1] as BandCalibrationPoint).massKg : null,
  };

  if (sorted.length < cfg.minCalibrationPoints) {
    return { calibration: base, reason: 'TOO_FEW_POINTS', r2: null };
  }

  const xs = sorted.map((p) => p.lengthCm / restLengthCm);
  const ys = sorted.map((p) => p.massKg);

  const linear = linearFit(xs, ys);
  if (!linear) return { calibration: base, reason: 'NO_STRETCH', r2: null };
  if (linear.r2 >= cfg.linearR2Threshold) {
    return {
      calibration: { ...base, fit: { type: 'linear', coeffs: linear.coeffs } },
      reason: 'FIT_LINEAR',
      r2: linear.r2,
    };
  }

  // Three distinct λ values are needed for a parabola; with fewer the
  // normal equations are singular and the straight line is all there is.
  const quadratic = quadraticFit(xs, ys) ?? linear;
  const type = quadratic === linear ? 'linear' : 'quadratic';
  return {
    calibration: { ...base, fit: { type, coeffs: quadratic.coeffs } },
    reason: type === 'linear' ? 'FIT_LINEAR' : 'FIT_QUADRATIC',
    r2: quadratic.r2,
  };
}

/**
 * Whether the last measurement added less length than the threshold —
 * the wizard's cue that hanging more mass will not teach anything.
 */
export function stretchHasPlateaued(
  points: readonly BandCalibrationPoint[],
  cfg = BAND_CONFIG,
): boolean {
  if (points.length < 2) return false;
  const sorted = [...points].sort((a, b) => a.massKg - b.massKg);
  const last = sorted[sorted.length - 1] as BandCalibrationPoint;
  const prev = sorted[sorted.length - 2] as BandCalibrationPoint;
  return last.lengthCm - prev.lengthCm < cfg.minLengthStepCm;
}

export type LoadEstimate =
  /** No usable fit: show the band and position, never kilograms. */
  | { kind: 'none' }
  /** The rep goes past the calibrated range: show "> max", never an extrapolated number. */
  | { kind: 'above'; maxMeasuredKg: number }
  /** Both ends of the rep are inside the calibrated range. Whole kilograms. */
  | { kind: 'range'; minKg: number; maxKg: number };

/**
 * Load range over one concentric at a given anchor position: from the
 * band's start length (rest + position steps) to that plus the exercise's
 * range of motion. A start below rest length would be slack, so the low
 * end is clamped at zero.
 */
export function estimateBandLoad(
  calibration: BandCalibration | null,
  position: AnchorPosition,
  romCm: number,
  cfg = BAND_CONFIG,
): LoadEstimate {
  if (!calibration || !calibration.fit || calibration.maxMeasuredKg === null) {
    return { kind: 'none' };
  }
  const { restLengthCm, fit, maxMeasuredKg } = calibration;
  const startLen = restLengthCm + position * cfg.anchorStepCm;
  const endLen = startLen + romCm;
  const at = (len: number) => Math.max(0, evaluate(fit, len / restLengthCm));
  const lo = Math.min(at(startLen), at(endLen));
  const hi = Math.max(at(startLen), at(endLen));
  if (hi > maxMeasuredKg) return { kind: 'above', maxMeasuredKg };
  return { kind: 'range', minKg: Math.round(lo), maxKg: Math.round(hi) };
}

/**
 * The single number stored on a set log: the peak of the range (end of
 * the concentric), or null whenever the range cannot be stated — so the
 * column never holds an extrapolation either.
 */
export function estimatedPeakKg(estimate: LoadEstimate): number | null {
  return estimate.kind === 'range' ? estimate.maxKg : null;
}

/** Recalibration is due after N cycles or N days, whichever first. SPEC §5.6. */
export function needsRecalibration(
  band: { cycleCount: number; calibratedAt: string | null },
  now: Date,
  cfg = BAND_CONFIG,
): boolean {
  if (band.calibratedAt === null) return false;
  if (band.cycleCount >= cfg.recalibrateAfterCycles) return true;
  const ageDays = (now.getTime() - Date.parse(band.calibratedAt)) / 86_400_000;
  return ageDays >= cfg.recalibrateAfterDays;
}
