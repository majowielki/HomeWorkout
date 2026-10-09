/**
 * Engine v2, P3 (03 §13, 13 §8, §20; T87, T104): settling the start of a new
 * exercise in one session.
 */
import {
  calibrationProposal,
  calibrationRuleOf,
  type CalibrationInput,
} from '../progression/firstExposure';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';
import { BODY, PAIRED, body, day, exposureOf, kg, type SetResult } from './progressionFixtures';

const policy = DEFAULT_PROGRESSION_POLICY;

/** The first set of an exposure, as the session sees it just after it was saved. */
const first = (spec: ReturnType<typeof kg>, set: SetResult, seconds = false) =>
  exposureOf({ date: day(0), spec, sets: [set, null], seconds }).sets[0]!;

const input = (
  set: CalibrationInput['set'],
  patch: Partial<CalibrationInput> = {},
): CalibrationInput => ({
  set,
  state: { stepsUp: 0, stepsDown: 0 },
  model: PAIRED,
  policy,
  easierVariant: null,
  ...patch,
});

describe('the rule', () => {
  it('is the policy’s: two steps up, one down', () => {
    expect(calibrationRuleOf(policy)).toEqual({
      kind: 'calibration',
      maxSteps: 2,
      maxStepsDown: 1,
      upIf: { effortAtLeast: 3, amountAtLeast: 'target.max' },
      downIf: { effortAtMost: 1, amountBelow: 'target.min' },
    });
  });
});

describe('T87 too easy: the next step for the sets that remain', () => {
  const easy = first(kg(4), { amount: 12, rir: 3 });

  it('at the top of the range and with room to spare', () => {
    expect(calibrationProposal(input(easy))).toEqual({
      kind: 'step_up',
      to: kg(6),
      code: 'CALIBRATION_STEP',
    });
  });

  it('twice in a session, and not a third time', () => {
    expect(
      calibrationProposal(input(easy, { state: { stepsUp: 1, stepsDown: 0 } })),
    ).not.toBeNull();
    expect(calibrationProposal(input(easy, { state: { stepsUp: 2, stepsDown: 0 } }))).toBeNull();
  });

  it('not when it was hard, or short of the top, or when there is nothing harder', () => {
    expect(calibrationProposal(input(first(kg(4), { amount: 12, rir: 2 })))).toBeNull();
    expect(calibrationProposal(input(first(kg(4), { amount: 11, rir: 4 })))).toBeNull();
    expect(calibrationProposal(input(first(kg(10), { amount: 12, rir: 4 })))).toBeNull();
  });

  it('from what was really used, not what was planned', () => {
    const set = first(kg(6), { amount: 12, rir: 3, spec: kg(4) });
    expect(calibrationProposal(input(set))).toMatchObject({ kind: 'step_up', to: kg(6) });
  });

  it('from the plan when the setup of the result is not known', () => {
    const set = first(kg(4), { amount: 12, rir: 3 });
    set.observation!.resistance = { ...set.observation!.resistance, value: null };
    expect(calibrationProposal(input(set))).toMatchObject({ kind: 'step_up', to: kg(6) });
  });
});

describe('T104 too hard: easier, or an easier variant, or a lower aim', () => {
  const hard = (spec: ReturnType<typeof kg>, amount = 4) => first(spec, { amount, rir: 0 });

  it('a lighter step where there is one', () => {
    expect(calibrationProposal(input(hard(kg(4), 5)))).toEqual({
      kind: 'step_down',
      to: kg(2),
      code: 'CALIBRATION_STEP_DOWN',
    });
  });

  it('an easier variant where there is no lighter step; the step comes first', () => {
    const variant = { easierVariant: 'dead-bug' };
    expect(calibrationProposal(input(hard(body), { model: BODY, ...variant }))).toEqual({
      kind: 'swap_remaining',
      variantId: 'dead-bug',
      code: 'VARIANT_DOWN_SUGGESTED',
    });
    expect(calibrationProposal(input(hard(kg(4), 5), variant))).toMatchObject({
      kind: 'step_down',
    });
  });

  it('the result of this set as the aim for the rest where there is nothing easier', () => {
    expect(calibrationProposal(input(hard(body), { model: BODY }))).toEqual({
      kind: 'lower_target',
      target: 4,
      code: 'BUILDUP_BELOW_RANGE',
    });
    const hold = first(body, { amount: 8, rir: 0 }, true);
    expect(calibrationProposal(input(hold, { model: BODY }))).toMatchObject({
      kind: 'lower_target',
      target: 8,
    });
    const least = first(body, { amount: 3, rir: 0 }, true);
    expect(calibrationProposal(input(least, { model: BODY }))).toMatchObject({ target: 5 });
  });

  it('once in a session', () => {
    const state = { stepsUp: 0, stepsDown: 1 };
    expect(calibrationProposal(input(hard(kg(4), 5), { state }))).toBeNull();
  });

  it('not when it was not that hard, or not under the range', () => {
    expect(calibrationProposal(input(first(kg(4), { amount: 5, rir: 2 })))).toBeNull();
    expect(calibrationProposal(input(first(kg(4), { amount: 9, rir: 0 })))).toBeNull();
  });
});

describe('what it does not decide', () => {
  it('nothing for a set that was not done, or whose effort nobody gave', () => {
    const skipped = exposureOf({ date: day(0), spec: kg(4), sets: [null, 12] }).sets[0]!;
    expect(calibrationProposal(input(skipped))).toBeNull();
    expect(calibrationProposal(input(first(kg(4), { amount: 12, rir: null })))).toBeNull();
  });

  it('nothing in a measure no policy reads', () => {
    const set = first(kg(4), { amount: 12, rir: 3 });
    set.planned.target = { kind: 'distance', targetMeters: 100 };
    expect(calibrationProposal(input(set))).toBeNull();
  });
});
