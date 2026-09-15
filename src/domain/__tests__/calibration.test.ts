import { BAND_CONFIG } from '../config/training';
import {
  estimateBandLoad,
  estimatedPeakKg,
  evaluate,
  fitCalibration,
  needsRecalibration,
  stretchHasPlateaued,
} from '../progression/calibration';
import type { BandCalibration, BandCalibrationPoint } from '../types';

const L0 = 100;

/** Points generated from a known F(λ) so a fit can be checked against the truth. */
function pointsFrom(f: (lambda: number) => number, lambdas: number[]): BandCalibrationPoint[] {
  return lambdas.map((lambda) => ({ massKg: f(lambda), lengthCm: lambda * L0 }));
}

describe('fitCalibration', () => {
  it('rejects a non-positive rest length and points shorter than it', () => {
    expect(() => fitCalibration(0, [])).toThrow(RangeError);
    expect(() => fitCalibration(L0, [{ massKg: 2, lengthCm: 90 }])).toThrow(RangeError);
    expect(() => fitCalibration(L0, [{ massKg: 0, lengthCm: 120 }])).toThrow(RangeError);
  });

  it('refuses to fit fewer than four points but keeps them and the max mass', () => {
    const result = fitCalibration(L0, [
      { massKg: 4, lengthCm: 130 },
      { massKg: 2, lengthCm: 115 },
      { massKg: 6, lengthCm: 145 },
    ]);
    expect(result.reason).toBe('TOO_FEW_POINTS');
    expect(result.r2).toBeNull();
    expect(result.calibration.fit).toBeNull();
    expect(result.calibration.maxMeasuredKg).toBe(6);
    expect(result.calibration.points.map((p) => p.massKg)).toEqual([2, 4, 6]);
  });

  it('has no max mass with no points at all', () => {
    expect(fitCalibration(L0, []).calibration.maxMeasuredKg).toBeNull();
  });

  it('reports NO_STRETCH when the lengths do not respond to mass (the green band)', () => {
    const result = fitCalibration(
      L0,
      [2, 4, 6, 8].map((massKg) => ({ massKg, lengthCm: L0 })),
    );
    expect(result.reason).toBe('NO_STRETCH');
    expect(result.calibration.fit).toBeNull();
    expect(result.calibration.maxMeasuredKg).toBe(8);
  });

  it('picks a linear fit for linear data and recovers the coefficients', () => {
    const truth = (l: number) => 20 * (l - 1);
    const result = fitCalibration(L0, pointsFrom(truth, [1.1, 1.2, 1.3, 1.5, 1.8]));
    expect(result.reason).toBe('FIT_LINEAR');
    expect(result.r2).toBeCloseTo(1, 6);
    const fit = result.calibration.fit!;
    expect(fit.type).toBe('linear');
    expect(fit.coeffs[0]).toBeCloseTo(-20, 6);
    expect(fit.coeffs[1]).toBeCloseTo(20, 6);
    expect(evaluate(fit, 1.5)).toBeCloseTo(10, 6);
  });

  it('falls back to quadratic when a line explains the data poorly', () => {
    const truth = (l: number) => 20 * (l - 1) ** 2;
    const result = fitCalibration(L0, pointsFrom(truth, [1.05, 1.1, 1.2, 1.5, 2.0]));
    expect(result.reason).toBe('FIT_QUADRATIC');
    expect(result.r2).toBeCloseTo(1, 6);
    const fit = result.calibration.fit!;
    expect(fit.type).toBe('quadratic');
    // 20(λ-1)² = 20 − 40λ + 20λ²
    expect(fit.coeffs[0]).toBeCloseTo(20, 4);
    expect(fit.coeffs[1]).toBeCloseTo(-40, 4);
    expect(fit.coeffs[2]).toBeCloseTo(20, 4);
    expect(evaluate(fit, 1.5)).toBeCloseTo(5, 4);
  });

  it('stays linear when a parabola cannot be fitted (only two distinct lengths)', () => {
    const result = fitCalibration(L0, [
      { massKg: 2, lengthCm: 100 },
      { massKg: 4, lengthCm: 100 },
      { massKg: 6, lengthCm: 150 },
      { massKg: 8, lengthCm: 150 },
    ]);
    expect(result.reason).toBe('FIT_LINEAR');
    expect(result.calibration.fit?.type).toBe('linear');
    expect(result.r2).toBeCloseTo(0.8, 6);
  });

  it('treats a constant mass as perfectly explained', () => {
    const result = fitCalibration(
      L0,
      [110, 120, 130, 140].map((lengthCm) => ({ massKg: 4, lengthCm })),
    );
    expect(result.reason).toBe('FIT_LINEAR');
    expect(result.r2).toBe(1);
  });

  it('honours a custom minimum point count', () => {
    const cfg = { ...BAND_CONFIG, minCalibrationPoints: 2 };
    const result = fitCalibration(
      L0,
      pointsFrom((l) => 20 * (l - 1), [1.1, 1.4]),
      cfg,
    );
    expect(result.reason).toBe('FIT_LINEAR');
  });
});

describe('stretchHasPlateaued', () => {
  it('needs two points', () => {
    expect(stretchHasPlateaued([{ massKg: 2, lengthCm: 110 }])).toBe(false);
  });

  it('flags a last step under the threshold, regardless of input order', () => {
    expect(
      stretchHasPlateaued([
        { massKg: 6, lengthCm: 130.5 },
        { massKg: 2, lengthCm: 110 },
        { massKg: 4, lengthCm: 130 },
      ]),
    ).toBe(true);
    expect(
      stretchHasPlateaued(
        [
          { massKg: 2, lengthCm: 110 },
          { massKg: 4, lengthCm: 113 },
        ],
        { ...BAND_CONFIG, minLengthStepCm: 5 },
      ),
    ).toBe(true);
  });

  it('is quiet while the band keeps stretching', () => {
    expect(
      stretchHasPlateaued([
        { massKg: 2, lengthCm: 110 },
        { massKg: 4, lengthCm: 120 },
      ]),
    ).toBe(false);
  });
});

describe('estimateBandLoad', () => {
  // F(λ) = 20(λ − 1): 0 kg at rest, 2 kg per 10 % stretch, calibrated up to 12 kg.
  const linear: BandCalibration = {
    restLengthCm: L0,
    points: [],
    fit: { type: 'linear', coeffs: [-20, 20] },
    maxMeasuredKg: 12,
  };

  it('shows nothing without a calibration or without a fit', () => {
    expect(estimateBandLoad(null, 2, 50)).toEqual({ kind: 'none' });
    expect(estimateBandLoad({ ...linear, fit: null }, 2, 50)).toEqual({ kind: 'none' });
    expect(estimateBandLoad({ ...linear, maxMeasuredKg: null }, 2, 50)).toEqual({ kind: 'none' });
  });

  it('gives the range from the start of the rep to its end', () => {
    // P1: start 130 cm (λ 1.3 → 6 kg), end 160 cm (λ 1.6 → 12 kg)
    expect(estimateBandLoad(linear, 1, 30)).toEqual({ kind: 'range', minKg: 6, maxKg: 12 });
  });

  it('never extrapolates past the heaviest measured mass', () => {
    // P2 start 160 cm = 12 kg, end 200 cm would be 20 kg
    expect(estimateBandLoad(linear, 2, 40)).toEqual({ kind: 'above', maxMeasuredKg: 12 });
  });

  it('clamps a slack start at zero', () => {
    const slack: BandCalibration = { ...linear, fit: { type: 'linear', coeffs: [-30, 20] } };
    // P0: start λ 1 → −10 → 0; end 150 cm → λ 1.5 → 0
    expect(estimateBandLoad(slack, 0, 50)).toEqual({ kind: 'range', minKg: 0, maxKg: 0 });
  });

  it('orders the range even for a fit that decreases with stretch', () => {
    const odd: BandCalibration = { ...linear, fit: { type: 'linear', coeffs: [30, -10] } };
    // start λ 1 → 20 → capped? 20 > 12 → above. Use a smaller cap-free case:
    const capped: BandCalibration = { ...odd, maxMeasuredKg: 30 };
    expect(estimateBandLoad(capped, 0, 50)).toEqual({ kind: 'range', minKg: 15, maxKg: 20 });
  });

  it('uses a custom anchor step', () => {
    const cfg = { ...BAND_CONFIG, anchorStepCm: 10 };
    // P1 start 110 (2 kg), end 120 (4 kg)
    expect(estimateBandLoad(linear, 1, 10, cfg)).toEqual({ kind: 'range', minKg: 2, maxKg: 4 });
  });
});

describe('estimatedPeakKg', () => {
  it('stores the top of a range and nothing otherwise', () => {
    expect(estimatedPeakKg({ kind: 'range', minKg: 6, maxKg: 12 })).toBe(12);
    expect(estimatedPeakKg({ kind: 'above', maxMeasuredKg: 12 })).toBeNull();
    expect(estimatedPeakKg({ kind: 'none' })).toBeNull();
  });
});

describe('needsRecalibration', () => {
  const now = new Date('2026-09-15T10:00:00Z');

  it('is never due for a band that was never calibrated', () => {
    expect(needsRecalibration({ cycleCount: 99_999, calibratedAt: null }, now)).toBe(false);
  });

  it('is due after the cycle budget', () => {
    expect(
      needsRecalibration({ cycleCount: 5000, calibratedAt: '2026-09-01T00:00:00Z' }, now),
    ).toBe(true);
  });

  it('is due after six months', () => {
    expect(needsRecalibration({ cycleCount: 10, calibratedAt: '2026-03-01T00:00:00Z' }, now)).toBe(
      true,
    );
  });

  it('is quiet for a fresh, lightly used calibration', () => {
    expect(needsRecalibration({ cycleCount: 10, calibratedAt: '2026-09-01T00:00:00Z' }, now)).toBe(
      false,
    );
    expect(
      needsRecalibration({ cycleCount: 10, calibratedAt: '2026-09-01T00:00:00Z' }, now, {
        ...BAND_CONFIG,
        recalibrateAfterDays: 7,
      }),
    ).toBe(true);
  });
});
