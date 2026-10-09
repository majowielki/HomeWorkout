import { legalObservation } from '@/domain/__tests__/planFixtures';
import { describeResult, describeSet, type DescribedSet } from '../describeSet';

const set = (overrides: Partial<DescribedSet>): DescribedSet => ({
  reps: 12,
  timeSec: null,
  rir: 2,
  weightKg: 14,
  bandId: null,
  anchorPosition: null,
  estimatedLoadKg: null,
  side: null,
  shortfall: null,
  ...overrides,
});

describe('describeSet', () => {
  it('reads load, reps and RIR', () => {
    expect(describeSet(set({}))).toBe('14 kg × 12 · RIR 2');
  });

  it('ends with the reason a set fell short', () => {
    expect(describeSet(set({ reps: 6, rir: 1, shortfall: 'short_rest' }))).toBe(
      '14 kg × 6 · RIR 1 · krótka przerwa',
    );
  });

  it('names the side of a one-sided hold', () => {
    expect(
      describeSet(set({ reps: null, timeSec: 30, weightKg: null, rir: null, side: 'left' })),
    ).toBe('lewa: masa ciała 30 s');
  });

  it('names a band by its colour and position, with the load it is worth when known', () => {
    const band = set({ weightKg: null, bandId: 'black', anchorPosition: 2, reps: 10 });
    expect(describeSet(band)).toBe('czarna P2 × 10 · RIR 2');
    expect(describeSet({ ...band, estimatedLoadKg: 12 })).toContain('12');
    expect(describeSet({ ...band, bandId: 'unknown', anchorPosition: null })).toContain('unknown');
  });

  it('describes a result by the columns it stands for', () => {
    expect(describeResult(legalObservation())).toBe('lewa: 4 kg × 12 · RIR 2');
  });
});
