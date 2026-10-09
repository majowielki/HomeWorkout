/**
 * Engine v2, P3 (03 §16, 13 §17, T93, T94): when a deload week starts.
 */
import type { DeloadInput } from '../plan/reactiveDeload';
import { reactiveDeloadTrigger } from '../plan/reactiveDeload';
import type { DailyReadiness } from '../plan/types';
import { assess } from '../progression/assessed';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';
import { PAIRED, day, exposureOf, kg } from './progressionFixtures';

const flat = (mass = 4) =>
  assess(
    [0, 2, 4].map((d) => exposureOf({ date: day(d), spec: kg(mass), sets: [10, 10] })),
    DEFAULT_PROGRESSION_POLICY,
    PAIRED,
  );
const moving = assess(
  [9, 10, 11].map((r, i) => exposureOf({ date: day(i * 2), spec: kg(4), sets: [r, r] })),
  DEFAULT_PROGRESSION_POLICY,
  PAIRED,
);
const stalled = { history: flat(), model: PAIRED };
const going = { history: moving, model: PAIRED };

const input = (patch: Partial<DeloadInput> = {}): DeloadInput => ({
  asOf: day(20),
  block: { startedOn: day(10), deloadFrom: null },
  signals: [],
  keyExercises: [],
  daily: [],
  requested: false,
  ...patch,
});
const night = (
  date: number,
  sleepHours: number | null,
  energy: number | null = null,
): DailyReadiness => ({
  date: day(date),
  sleepHours,
  energy,
  soreness: null,
});

describe('T93 a block with nothing wrong has no deload', () => {
  it('no signals, nothing stalled: no deload, and no deload because 28 days went by', () => {
    expect(reactiveDeloadTrigger(input({ asOf: day(10 + 35) }))).toEqual({
      trigger: false,
      reasons: [],
    });
  });

  it('one signal is not enough, even repeated', () => {
    const one = input({ signals: ['FATIGUE_HIGH', 'FATIGUE_HIGH'] });
    expect(reactiveDeloadTrigger(one).trigger).toBe(false);
  });
});

describe('T94 the signals ask for a deload', () => {
  it('two different signals, a week into the block', () => {
    const two = input({ signals: ['FATIGUE_HIGH', 'RECOVERY_LOW'] });
    expect(reactiveDeloadTrigger({ ...two, asOf: day(17) })).toEqual({
      trigger: true,
      reasons: ['SIGNALS_2PLUS'],
    });
  });

  it('not in the first week of a block', () => {
    const two = input({ signals: ['FATIGUE_HIGH', 'RECOVERY_LOW'], asOf: day(15) });
    expect(reactiveDeloadTrigger(two).trigger).toBe(false);
  });

  it('a stall of two key lifts together with poor sleep', () => {
    const tired = input({
      keyExercises: [stalled, { history: flat(6), model: PAIRED }],
      daily: [night(19, 5)],
    });
    expect(reactiveDeloadTrigger(tired)).toEqual({
      trigger: true,
      reasons: ['STALL_WITH_FATIGUE'],
    });
  });

  it('or low energy', () => {
    const tired = input({ keyExercises: [stalled, stalled], daily: [night(20, 7, 2)] });
    expect(reactiveDeloadTrigger(tired).reasons).toEqual(['STALL_WITH_FATIGUE']);
  });

  it('a stall alone is not a reason; nor is poor sleep alone', () => {
    expect(
      reactiveDeloadTrigger(input({ keyExercises: [stalled, stalled], daily: [night(19, 8, 4)] }))
        .trigger,
    ).toBe(false);
    expect(
      reactiveDeloadTrigger(input({ keyExercises: [stalled, going], daily: [night(19, 5)] }))
        .trigger,
    ).toBe(false);
    expect(
      reactiveDeloadTrigger(input({ keyExercises: [going, going], daily: [night(19, 5)] })).trigger,
    ).toBe(false);
  });

  it('poor sleep from before the last three days is no longer fatigue', () => {
    expect(
      reactiveDeloadTrigger(
        input({ keyExercises: [stalled, stalled], daily: [night(10, 4), night(21, 5)] }),
      ).trigger,
    ).toBe(false);
    expect(
      reactiveDeloadTrigger(input({ keyExercises: [stalled, stalled], daily: [night(18, 5)] }))
        .trigger,
    ).toBe(true);
  });

  it('a night that was not logged is not a poor one', () => {
    expect(
      reactiveDeloadTrigger(
        input({ keyExercises: [stalled, stalled], daily: [night(19, null, null)] }),
      ).trigger,
    ).toBe(false);
  });

  it('both reasons are given', () => {
    const both = input({
      signals: ['FATIGUE_HIGH', 'PERFORMANCE_DROP'],
      keyExercises: [stalled, stalled],
      daily: [night(19, 5)],
    });
    expect(reactiveDeloadTrigger(both).reasons).toEqual(['SIGNALS_2PLUS', 'STALL_WITH_FATIGUE']);
  });
});

describe('the person asks', () => {
  it('is honoured at once, in the first week too', () => {
    expect(reactiveDeloadTrigger(input({ asOf: day(11), requested: true }))).toEqual({
      trigger: true,
      reasons: ['USER_REQUEST'],
    });
  });

  it('once per block: after a deload began, no other starts', () => {
    const begun = input({
      block: { startedOn: day(10), deloadFrom: day(18) },
      requested: true,
      signals: ['FATIGUE_HIGH', 'RECOVERY_LOW'],
    });
    expect(reactiveDeloadTrigger(begun)).toEqual({ trigger: false, reasons: [] });
  });
});
