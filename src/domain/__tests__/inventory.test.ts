import {
  DUMBBELLS,
  LADDER_PAIRED,
  LADDER_SINGLE,
  MAX_CALIBRATION_MASS_KG,
  dumbbellLadder,
  isAtCeiling,
  nextRung,
  previousRung,
} from '../inventory';

describe('dumbbellLadder', () => {
  it('derives the paired ladder: plates split across both bars', () => {
    // 8x1 kg + 4x2 kg shared between two bars -> 4x1 + 2x2 per bar,
    // loaded symmetrically, so the dumbbell tops out at 10 kg.
    expect(LADDER_PAIRED).toEqual([2, 4, 6, 8, 10]);
  });

  it('derives the single ladder: every plate on one bar', () => {
    // This is the ladder goblet squats actually use, and the only reason
    // the lower body gets past 10 kg at all.
    expect(LADDER_SINGLE).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  it('never produces an asymmetric load', () => {
    for (const ladder of [LADDER_PAIRED, LADDER_SINGLE]) {
      for (const weight of ladder) {
        expect((weight - DUMBBELLS.barMassKg) % 2).toBe(0);
      }
    }
  });

  it('steps by 2 kg, which is a large jump at the light end', () => {
    // 8 -> 10 kg is +25%, far past the usual "max 10% per week" guidance.
    // The engine compensates by gating progression on the rep target
    // instead of a percentage cap. See SPEC-silnik-regul.md §5.1.
    const steps = LADDER_SINGLE.slice(1).map((w, i) => w - (LADDER_SINGLE[i] as number));
    expect(new Set(steps)).toEqual(new Set([2]));
  });

  it('scales with a different inventory', () => {
    const ladder = dumbbellLadder('single', {
      bars: 1,
      barMassKg: 1.5,
      plates: [{ massKg: 2.5, count: 4 }],
    });
    expect(ladder).toEqual([1.5, 6.5, 11.5]);
  });
});

describe('rung navigation', () => {
  it('moves one rung at a time', () => {
    expect(nextRung(LADDER_SINGLE, 8)).toBe(10);
    expect(previousRung(LADDER_SINGLE, 8)).toBe(6);
  });

  it('clamps at the ceiling instead of inventing weight', () => {
    expect(nextRung(LADDER_PAIRED, 10)).toBe(10);
    expect(isAtCeiling(LADDER_PAIRED, 10)).toBe(true);
    expect(isAtCeiling(LADDER_SINGLE, 10)).toBe(false);
  });

  it('clamps at the floor', () => {
    expect(previousRung(LADDER_SINGLE, 2)).toBe(2);
  });

  it('snaps a weight that is not on the ladder', () => {
    expect(nextRung(LADDER_SINGLE, 7)).toBe(8);
    expect(previousRung(LADDER_SINGLE, 7)).toBe(6);
  });

  it('clamps an off-ladder weight beyond either end', () => {
    // e.g. a log imported from a different set of equipment
    expect(nextRung(LADDER_SINGLE, 99)).toBe(18);
    expect(previousRung(LADDER_SINGLE, 0.5)).toBe(2);
  });
});

describe('calibration ceiling', () => {
  it('caps band calibration at the heaviest single dumbbell', () => {
    expect(MAX_CALIBRATION_MASS_KG).toBe(18);
  });

  it('cannot reach the green band, whose nominal range starts at 27 kg', () => {
    // Not an edge case: the green band is the main source of lower-body
    // load, and it will never have a calibration curve. See PLAN.md §5.3.
    expect(MAX_CALIBRATION_MASS_KG).toBeLessThan(27);
  });
});
