import type { SetLogRow } from '@/db/repositories/setLogs';
import { V1_SET_COLUMNS } from '@/db/__tests__/rowDefaults';
import { describeSet } from '../describeSet';

const row = (overrides: Partial<SetLogRow>): SetLogRow => ({
  id: 's',
  workoutId: 'w',
  exerciseId: 'e',
  exerciseOrder: 0,
  setIndex: 1,
  isWarmup: false,
  reps: 12,
  timeSec: null,
  rir: 2,
  weightKg: 14,
  dumbbellMode: 'paired',
  bandId: null,
  anchorPosition: null,
  estimatedLoadKg: null,
  side: null,
  shortfall: null,
  loggedAt: '2026-10-08T10:00:00.000Z',
  ...V1_SET_COLUMNS,
  ...overrides,
});

describe('describeSet', () => {
  it('reads load, reps and RIR', () => {
    expect(describeSet(row({}))).toBe('14 kg × 12 · RIR 2');
  });

  it('ends with the reason a set fell short', () => {
    expect(describeSet(row({ reps: 6, rir: 1, shortfall: 'short_rest' }))).toBe(
      '14 kg × 6 · RIR 1 · krótka przerwa',
    );
  });

  it('names the side of a one-sided hold', () => {
    expect(
      describeSet(row({ reps: null, timeSec: 30, weightKg: null, rir: null, side: 'left' })),
    ).toBe('lewa: masa ciała 30 s');
  });
});
