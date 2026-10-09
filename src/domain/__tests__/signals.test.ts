/**
 * Engine v2, P4 (SPEC §6.1): the overload signals, read from what was done.
 */
import { fatigueSignals, type SignalsInput } from '../autoregulation/signals';
import type { DailyReadiness } from '../plan/types';
import { PAIRED, day, exposureOf, kg } from './progressionFixtures';
import { modelOf } from './compileFixtures';

const AS_OF = day(13);
const slotOf = new Map([
  ['ex-squat', { kind: 'compound' as const }],
  ['ex-curl', { kind: 'accessory' as const }],
]);
const input = (
  records: SignalsInput['records'],
  patch: Partial<SignalsInput> = {},
): SignalsInput => ({
  asOf: AS_OF,
  records,
  slotOf,
  daily: [],
  modelOf,
  ...patch,
});
const at = (
  date: number,
  sets: Parameters<typeof exposureOf>[0]['sets'],
  slotId = 'squat',
  mass = 4,
) => ({
  ...exposureOf({
    date: day(date),
    spec: kg(mass),
    sets,
    key: `k-${slotId}-${mass}`,
    exerciseId: `ex-${slotId}`,
  }),
});

describe('FATIGUE_HIGH: to the limit on a compound lift two days running', () => {
  const limit = [{ amount: 10, rir: 0 }, 10];

  it('on each of the last two days that had one', () => {
    expect(fatigueSignals(input([at(10, limit), at(12, limit)]))).toEqual(['FATIGUE_HIGH']);
  });

  it('not when the second day was not to the limit, or it was the only one', () => {
    expect(fatigueSignals(input([at(10, limit), at(12, [10, 10])]))).toEqual([]);
    expect(fatigueSignals(input([at(12, limit)]))).toEqual([]);
  });

  it('a second session the same day is not a second day', () => {
    expect(fatigueSignals(input([at(12, limit), at(12, limit)]))).toEqual([]);
  });

  it('only compound lifts, only work, only what is recent', () => {
    expect(fatigueSignals(input([at(10, limit, 'curl'), at(12, limit, 'curl')]))).toEqual([]);
    const noSlot = { ...at(12, limit), exerciseId: 'unknown' };
    expect(fatigueSignals(input([at(10, limit), noSlot]))).toEqual([]);
    const nothing = at(12, [null, null]);
    expect(fatigueSignals(input([at(10, limit), nothing]))).toEqual([]);
    expect(fatigueSignals(input([at(-5, limit), at(12, limit)]))).toEqual([]);
    expect(fatigueSignals(input([at(10, limit), at(14, limit)]))).toEqual([]);
  });

  it('a warm-up to the limit is not grinding', () => {
    const warm = [
      { amount: 10, rir: 0, planned: { role: 'warmup' as const, requiredForProgression: false } },
      null,
    ];
    expect(fatigueSignals(input([at(10, warm), at(12, warm)]))).toEqual([]);
  });
});

describe('PERFORMANCE_DROP: fewer at the same resistance, twice', () => {
  const exposures = (...bests: number[]) => bests.map((b, i) => at(8 + i * 2, [b, b - 1], 'squat'));

  it('three exposures, each worse than the one before', () => {
    expect(fatigueSignals(input(exposures(12, 11, 10)))).toEqual(['PERFORMANCE_DROP']);
  });

  it('not when one was no worse, or there are too few', () => {
    expect(fatigueSignals(input(exposures(12, 12, 10)))).toEqual([]);
    expect(fatigueSignals(input(exposures(12, 11)))).toEqual([]);
  });

  it('a lighter resistance is not a drop', () => {
    const list = [at(8, [12, 12]), at(10, [11, 11]), at(12, [10, 10], 'squat', 2)];
    const keyed = list.map((r) => ({ ...r, comparisonKey: 'same' }));
    expect(fatigueSignals(input(keyed))).toEqual([]);
  });

  it('only the first exposure of the day counts, and only a model that is known', () => {
    const secondary = exposures(12, 11, 10).map((r) => ({
      ...r,
      progressionScope: 'supplemental' as const,
    }));
    expect(fatigueSignals(input(secondary))).toEqual([]);
    expect(fatigueSignals(input(exposures(12, 11, 10), { modelOf: () => null }))).toEqual([]);
    expect(PAIRED).toBeDefined();
  });

  it('exposures with nothing done say nothing', () => {
    const list = [...exposures(12, 11), at(12, [null, null])];
    expect(fatigueSignals(input(list))).toEqual([]);
  });
});

describe('RECOVERY_LOW: poor sleep three days running, or one muscle sore for four', () => {
  const night = (
    date: number,
    sleepHours: number | null,
    soreness: DailyReadiness['soreness'] = null,
  ): DailyReadiness => ({
    date: day(date),
    sleepHours,
    energy: 3,
    soreness,
  });

  it('is read from the log of the days', () => {
    const poor = [11, 12, 13].map((d) => night(d, 5));
    expect(fatigueSignals(input([], { daily: poor }))).toEqual(['RECOVERY_LOW']);
    const sore = [10, 11, 12, 13].map((d) => night(d, 8, { quads: 4 }));
    expect(fatigueSignals(input([], { daily: sore }))).toEqual(['RECOVERY_LOW']);
    expect(fatigueSignals(input([], { daily: [night(13, 5)] }))).toEqual([]);
  });

  it('can come with the others', () => {
    const limit = [{ amount: 10, rir: 0 }, 10];
    const out = fatigueSignals(
      input([at(10, limit), at(12, limit)], { daily: [11, 12, 13].map((d) => night(d, 5)) }),
    );
    expect(out).toEqual(['FATIGUE_HIGH', 'RECOVERY_LOW']);
  });
});
