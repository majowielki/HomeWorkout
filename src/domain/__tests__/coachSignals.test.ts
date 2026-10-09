import { deriveSignals, type SignalInput } from '../coach/signals';
import { addDays } from '../time/trainingDate';

const ASOF = '2026-10-01';

function input(patch: Partial<SignalInput> = {}): SignalInput {
  return {
    asOf: ASOF,
    completedSessionCount: 12,
    lastSessionDate: addDays(ASOF, -2),
    sleep: [],
    ...patch,
  };
}

const sleepOn = (offsets: number[], hours: number) =>
  offsets.map((o) => ({ date: addDays(ASOF, o), value: hours }));

describe('deriveSignals — history', () => {
  it('is silent for an active, established lifter', () => {
    expect(deriveSignals(input())).toEqual([]);
  });

  it.each([
    [0, true],
    [3, true],
    [4, false],
  ])('flags SPARSE_HISTORY at the boundary: %i sessions -> %s', (count, flagged) => {
    expect(deriveSignals(input({ completedSessionCount: count }))).toEqual(
      flagged ? ['SPARSE_HISTORY'] : [],
    );
  });
});

describe('deriveSignals — layoff tiers (SPEC §6.3)', () => {
  it.each([
    [7, []],
    [8, ['LAYOFF_SHORT']],
    [14, ['LAYOFF_SHORT']],
    [15, ['LAYOFF_MEDIUM']],
    [30, ['LAYOFF_MEDIUM']],
    [31, ['LAYOFF_LONG']],
    [90, ['LAYOFF_LONG']],
  ])('%i days since the last session -> %j', (gap, expected) => {
    expect(deriveSignals(input({ lastSessionDate: addDays(ASOF, -gap) }))).toEqual(expected);
  });

  it('says nothing about layoff when there has never been a session', () => {
    expect(deriveSignals(input({ lastSessionDate: null, completedSessionCount: 0 }))).toEqual([
      'SPARSE_HISTORY',
    ]);
  });

  it('reports sparse history first, then layoff', () => {
    expect(
      deriveSignals(input({ completedSessionCount: 2, lastSessionDate: addDays(ASOF, -20) })),
    ).toEqual(['SPARSE_HISTORY', 'LAYOFF_MEDIUM']);
  });
});

describe('deriveSignals — sleep streak (SPEC §6.1)', () => {
  it('needs three consecutive short nights ending today', () => {
    expect(deriveSignals(input({ sleep: sleepOn([0, -1, -2], 5) }))).toEqual(['SLEEP_LOW_STREAK']);
  });

  it('accepts a run that ended yesterday, because today is not logged yet', () => {
    expect(deriveSignals(input({ sleep: sleepOn([-1, -2, -3], 5.5) }))).toEqual([
      'SLEEP_LOW_STREAK',
    ]);
  });

  it('does not count a run that ended two days ago', () => {
    expect(deriveSignals(input({ sleep: sleepOn([-2, -3, -4], 5) }))).toEqual([]);
  });

  it('is broken by one good night', () => {
    const sleep = [...sleepOn([0, -2], 5), ...sleepOn([-1], 7.5)];
    expect(deriveSignals(input({ sleep }))).toEqual([]);
  });

  it('is broken by a missing day', () => {
    expect(deriveSignals(input({ sleep: sleepOn([0, -2], 5) }))).toEqual([]);
  });

  it('treats exactly the threshold as enough sleep', () => {
    expect(deriveSignals(input({ sleep: sleepOn([0, -1, -2], 6) }))).toEqual([]);
  });
});
