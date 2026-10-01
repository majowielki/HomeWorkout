import { navyBodyFatPct } from '../metrics/navy';

describe('navyBodyFatPct', () => {
  it('computes the male formula (reference case)', () => {
    // 180 cm, waist 90, neck 40 -> 18.4% (Hodgdon & Beckett, metric/Siri form)
    const pct = navyBodyFatPct({ sex: 'male', heightCm: 180, waistCm: 90, neckCm: 40 });
    expect(pct).toBe(18.4);
  });

  it('computes the female formula (reference case)', () => {
    // 165 cm, waist 75, hips 95, neck 33 -> 26.9%
    const pct = navyBodyFatPct({
      sex: 'female',
      heightCm: 165,
      waistCm: 75,
      hipsCm: 95,
      neckCm: 33,
    });
    expect(pct).toBe(26.9);
  });

  it('is monotonic in waist for a fixed frame', () => {
    const base = { sex: 'male' as const, heightCm: 180, neckCm: 40 };
    const a = navyBodyFatPct({ ...base, waistCm: 85 })!;
    const b = navyBodyFatPct({ ...base, waistCm: 95 })!;
    expect(b).toBeGreaterThan(a);
  });

  it('returns null when the waist does not exceed the neck (log of <= 0)', () => {
    expect(navyBodyFatPct({ sex: 'male', heightCm: 180, waistCm: 40, neckCm: 40 })).toBeNull();
    expect(navyBodyFatPct({ sex: 'male', heightCm: 180, waistCm: 35, neckCm: 40 })).toBeNull();
  });

  it('returns null for non-positive inputs', () => {
    expect(navyBodyFatPct({ sex: 'male', heightCm: 0, waistCm: 90, neckCm: 40 })).toBeNull();
    expect(navyBodyFatPct({ sex: 'male', heightCm: 180, waistCm: -1, neckCm: 40 })).toBeNull();
    expect(
      navyBodyFatPct({ sex: 'female', heightCm: 165, waistCm: 75, hipsCm: 0, neckCm: 33 }),
    ).toBeNull();
  });

  it('returns null for a female frame where waist + hips does not exceed neck', () => {
    expect(
      navyBodyFatPct({ sex: 'female', heightCm: 165, waistCm: 10, hipsCm: 10, neckCm: 33 }),
    ).toBeNull();
  });

  it('rejects physiologically impossible results', () => {
    // absurd waist on a tiny frame pushes the estimate past 70%
    expect(navyBodyFatPct({ sex: 'male', heightCm: 150, waistCm: 250, neckCm: 30 })).toBeNull();
    // waist barely above neck on a tall frame goes below 2%
    expect(navyBodyFatPct({ sex: 'male', heightCm: 200, waistCm: 41, neckCm: 40 })).toBeNull();
  });

  it('does not silently accept the inch-formula error', () => {
    // A guard against regressing to the imperial constants: with cm inputs
    // those give 24.9 here instead of 18.4.
    const pct = navyBodyFatPct({ sex: 'male', heightCm: 180, waistCm: 90, neckCm: 40 })!;
    expect(pct).toBeLessThan(20);
  });
});
