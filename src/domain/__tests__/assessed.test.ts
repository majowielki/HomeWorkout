/**
 * Engine v2, P3 (13 §6, §13): the history as the rules read it.
 */
import {
  amountOfRequired,
  assess,
  hasData,
  logicalAmounts,
  logicalResults,
  logicalSetCount,
} from '../progression/assessed';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';
import { PAIRED, day, exposureOf, kg } from './progressionFixtures';

const policy = DEFAULT_PROGRESSION_POLICY;

describe('assess', () => {
  it('says what the exposure is evidence of, the step it is at and the range it was planned in', () => {
    const [a] = assess([exposureOf({ date: day(0), spec: kg(4), sets: [12, 12] })], policy, PAIRED);
    expect(a!.ev.performance).toBe('top_met');
    expect(a!.at).toEqual(kg(4));
    expect(a!.levelId).toBe('dumbbell.paired/4000');
    expect(a!.planned).toEqual({ lo: 8, hi: 12 });
    expect(hasData(a!)).toBe(true);
  });

  it('an exposure with no required set has no step and no range', () => {
    const rec = exposureOf({
      date: day(0),
      spec: kg(4),
      sets: [{ amount: 12, planned: { requiredForProgression: false, role: 'practice' } }],
    });
    const [a] = assess([rec], policy, PAIRED);
    expect(a).toMatchObject({ at: null, levelId: null, planned: null });
    expect(hasData(a!)).toBe(false);
  });

  it('a measure no policy reads has no range', () => {
    const rec = exposureOf({ date: day(0), spec: kg(4), sets: [12] });
    rec.sets[0]!.planned.target = { kind: 'distance', targetMeters: 50 };
    expect(assess([rec], policy, PAIRED)[0]!.planned).toBeNull();
  });
});

describe('what each logical set came to', () => {
  it('is the weaker of its sides, and the least in reserve', () => {
    const rec = exposureOf({
      date: day(0),
      spec: kg(4),
      sets: [{ amount: 10, rir: 3 }, { amount: 9 }],
      sides: true,
    });
    rec.sets[1]!.observation!.amount.value = { kind: 'reps', reps: 8 };
    rec.sets[1]!.observation!.rir.value = 1;
    expect(logicalResults(rec)).toEqual([
      { amount: 8, effort: 1 },
      { amount: 9, effort: 2 },
    ]);
    expect(logicalAmounts(rec)).toEqual([8, 9]);
    expect(logicalSetCount(rec)).toBe(2);
    expect(amountOfRequired(rec)).toEqual([10, 8, 9, 9]);
  });

  it('knows nothing of the effort when one side did not say', () => {
    const first = exposureOf({ date: day(0), spec: kg(4), sets: [{ amount: 10 }], sides: true });
    first.sets[0]!.observation!.rir.value = null;
    expect(logicalResults(first)).toEqual([{ amount: 10, effort: null }]);
    const second = exposureOf({ date: day(0), spec: kg(4), sets: [{ amount: 10 }], sides: true });
    second.sets[1]!.observation!.rir.value = null;
    expect(logicalResults(second)).toEqual([{ amount: 10, effort: null }]);
  });

  it('leaves out a set that was not done and one in a measure no policy reads', () => {
    expect(
      logicalResults(exposureOf({ date: day(0), spec: kg(4), sets: [12, null] })),
    ).toHaveLength(1);
    const rec = exposureOf({ date: day(0), spec: kg(4), sets: [12] });
    rec.sets[0]!.observation!.amount.value = { kind: 'distance', meters: 50 };
    expect(logicalResults(rec)).toEqual([]);
  });
});
