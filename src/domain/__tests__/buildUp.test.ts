/**
 * Engine v2, P3 (03 §17, 13 §20, T101-T103): building up to the range from the
 * person's own result where the resistance cannot get any easier.
 */
import { assess } from '../progression/assessed';
import { buildUpState, buildUpTargets, shouldSuggestVariantDown } from '../progression/buildUp';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';
import { BODY, PAIRED, body, day, exposureOf, kg, type SetResult } from './progressionFixtures';

const policy = DEFAULT_PROGRESSION_POLICY;
const RANGE = { lo: 8 };

/** An exposure of the body, planned to the bottom of the range or below it. */
const built = (date: number, sets: (SetResult | number | null)[], extra: object = {}) =>
  exposureOf({ date: day(date), spec: body, sets, ...extra });
const state = (records: ReturnType<typeof exposureOf>[], since?: string) =>
  buildUpState(assess(records, policy, BODY), BODY, RANGE, since);

describe('T101 where the build stands', () => {
  it('a set under the range at the easiest resistance starts it', () => {
    expect(state([built(0, [5, 4])])).toEqual({
      active: true,
      stalledExposures: 1,
      bestRequired: 5,
    });
  });

  it('the same total twice has stood still', () => {
    expect(state([built(0, [5, 4]), built(2, [5, 4])]).stalledExposures).toBe(2);
    expect(state([built(0, [5, 4]), built(2, [4, 5])]).stalledExposures).toBe(2);
  });

  it('a better total is not a stall', () => {
    expect(state([built(0, [5, 4]), built(2, [6, 4])]).stalledExposures).toBe(1);
    expect(state([built(0, [4, 4]), built(2, [5, 4]), built(4, [5, 4])]).stalledExposures).toBe(2);
    expect(state([built(0, [5, 4]), built(2, [6, 4]), built(4, [5, 4])]).stalledExposures).toBe(2);
  });

  it('is over once every set reached the bottom of the range', () => {
    expect(state([built(0, [5, 4]), built(2, [8, 8])])).toEqual({
      active: false,
      stalledExposures: 0,
      bestRequired: 8,
    });
  });

  it('is nothing before the first exposure with something done', () => {
    expect(state([])).toEqual({ active: false, stalledExposures: 0, bestRequired: 0 });
    expect(state([built(0, [null, null])]).active).toBe(false);
  });

  it('is not a build where the resistance could be eased', () => {
    const state4 = buildUpState(
      assess([exposureOf({ date: day(0), spec: kg(4), sets: [5, 4] })], policy, PAIRED),
      PAIRED,
      RANGE,
    );
    expect(state4.active).toBe(false);
    const lightest = buildUpState(
      assess([exposureOf({ date: day(0), spec: kg(2), sets: [5, 4] })], policy, PAIRED),
      PAIRED,
      RANGE,
    );
    expect(lightest.active).toBe(true);
  });

  it('is not built from an exposure that is not evidence', () => {
    expect(state([built(0, [5, null])]).active).toBe(false);
    expect(state([built(0, [5, { amount: 4, shortfall: 'pain' }])]).active).toBe(false);
    expect(state([built(0, [5, { amount: 4, shortfall: 'short_rest' }])]).active).toBe(false);
    expect(state([built(0, [5, { amount: 4, rir: null }])]).active).toBe(false);
  });

  it('a week of deload is neither part of the build nor a break in it', () => {
    const deload = built(3, [5, 4], { context: { deload: true } });
    expect(state([built(0, [5, 4]), deload, built(5, [5, 4])]).stalledExposures).toBe(2);
  });

  it('an exposure that was not a build ends the run that came before it', () => {
    const ok = built(2, [8, 8]);
    expect(state([built(0, [5, 4]), ok, built(4, [5, 4])]).stalledExposures).toBe(1);
  });

  it('what came before "not now" does not count towards the next proposal', () => {
    const records = [built(0, [5, 4]), built(2, [5, 4]), built(4, [5, 4])];
    expect(state(records).stalledExposures).toBe(3);
    expect(state(records, day(2)).stalledExposures).toBe(1);
    expect(state(records, day(4)).active).toBe(true);
    expect(state(records, day(4)).stalledExposures).toBe(0);
  });
});

describe('T101, T102 the target of the next exposure', () => {
  const last = (sets: (SetResult | number | null)[], extra: object = {}) => built(0, sets, extra);

  it('what was done plus a step, up to the bottom of the range', () => {
    expect(buildUpTargets(last([5, 4]), RANGE, 1, 2, 1)).toEqual([6, 5]);
    expect(buildUpTargets(last([8, 7]), RANGE, 1, 2, 1)).toEqual([8, 8]);
  });

  it('a set done to the limit is repeated, not raised and not lowered', () => {
    expect(buildUpTargets(last([5, { amount: 4, rir: 0 }]), RANGE, 1, 2, 1)).toEqual([6, 4]);
  });

  it('a set whose effort nobody gave is raised like any other', () => {
    expect(buildUpTargets(last([{ amount: 5, rir: null }]), RANGE, 1, 2, 1)).toEqual([6]);
  });

  it('never under the least a target can be', () => {
    expect(
      buildUpTargets(last([{ amount: 0, rir: 0, status: 'interrupted' }]), RANGE, 1, 2, 1),
    ).toEqual([]);
    expect(buildUpTargets(last([{ amount: 2, rir: 0 }]), RANGE, 1, 2, 5)).toEqual([5]);
  });

  it('the weaker side of a set is the set', () => {
    const sided = exposureOf({
      date: day(0),
      spec: body,
      sets: [{ amount: 5 }, { amount: 7 }],
      sides: true,
    });
    sided.sets[0]!.observation!.amount.value = { kind: 'reps', reps: 4 };
    sided.sets[1]!.observation!.rir.value = 0;
    expect(buildUpTargets(sided, RANGE, 1, 2, 1)).toEqual([4, 8]);
  });

  it('a hold is built in seconds', () => {
    const plank = exposureOf({ date: day(0), spec: body, sets: [15, 15], seconds: true });
    expect(buildUpTargets(plank, { lo: 20 }, 5, 2, 5)).toEqual([20, 20]);
    expect(buildUpTargets(plank, { lo: 40 }, 5, 2, 5)).toEqual([20, 20]);
  });
});

describe('T103 an easier variant is put to the person', () => {
  const s = (patch: Partial<ReturnType<typeof state>> = {}) => ({
    active: true,
    stalledExposures: 1,
    bestRequired: 5,
    ...patch,
  });

  it('far under the range: the best set at half of its bottom or less', () => {
    expect(shouldSuggestVariantDown(s({ bestRequired: 3 }), 8, policy)).toBe(true);
    expect(shouldSuggestVariantDown(s({ bestRequired: 4 }), 8, policy)).toBe(true);
    expect(shouldSuggestVariantDown(s({ bestRequired: 5 }), 8, policy)).toBe(false);
  });

  it('standing still: two exposures with no better total', () => {
    expect(shouldSuggestVariantDown(s({ stalledExposures: 2 }), 8, policy)).toBe(true);
    expect(shouldSuggestVariantDown(s({ stalledExposures: 1 }), 8, policy)).toBe(false);
  });

  it('after "not now" only a new stall asks again', () => {
    expect(shouldSuggestVariantDown(s({ bestRequired: 3 }), 8, policy, true)).toBe(false);
    expect(
      shouldSuggestVariantDown(s({ bestRequired: 3, stalledExposures: 2 }), 8, policy, true),
    ).toBe(true);
  });

  it('never when there is no build', () => {
    expect(
      shouldSuggestVariantDown(
        s({ active: false, bestRequired: 1, stalledExposures: 5 }),
        8,
        policy,
      ),
    ).toBe(false);
  });
});
