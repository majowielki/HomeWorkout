import { exerciseSeconds, planMinutes } from '../plan/estimate';

const planned = {
  sets: 2,
  unit: 'reps' as const,
  target: 10,
  restSec: 90,
  warmupSet: false,
};

describe('exerciseSeconds', () => {
  it('adds work, rest and the changeover', () => {
    // 2 × (10 × 4 s + 90 s) + 30 s
    expect(exerciseSeconds(planned, { stanceMechanics: 'Bilateral' })).toBe(290);
  });

  it('doubles the work of one-legged exercises', () => {
    expect(exerciseSeconds(planned, { stanceMechanics: 'UnilateralSupported' })).toBe(370);
    expect(exerciseSeconds(planned, { stanceMechanics: 'UnilateralUnsupported' })).toBe(370);
  });

  it('counts a hold in seconds and a band warm-up', () => {
    expect(
      exerciseSeconds(
        { ...planned, unit: 'sec', target: 30, warmupSet: true },
        { stanceMechanics: 'Prone' },
      ),
    ).toBe(2 * (30 + 90) + 30 + 60);
  });
});

describe('planMinutes', () => {
  it('sums and rounds up, treating unknown exercises as two-legged', () => {
    const list = [
      { ...planned, exerciseId: 'a' },
      { ...planned, exerciseId: 'ghost' },
    ];
    expect(planMinutes(list, { a: { stanceMechanics: 'Bilateral' } })).toBe(10); // 580 s
    expect(planMinutes([], {})).toBe(0);
  });
});
