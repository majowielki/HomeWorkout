/**
 * Engine v2, P3 (03 §8, 13 §7): what goes between "hold" and "step up".
 */
import { chooseIntermediateAxis, extendedTop, type AxisInput } from '../progression/axes';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';

const policy = DEFAULT_PROGRESSION_POLICY;
const input = (patch: Partial<AxisInput> = {}): AxisInput => ({
  policy,
  unit: 'reps',
  baseHi: 12,
  currentHi: 12,
  repCap: 25,
  recommendedSets: 2,
  allowedSets: 3,
  ...patch,
});

describe('how far the range may be extended', () => {
  it('reps: by five, but not past the cap (20 where the knee is loaded)', () => {
    expect(extendedTop(policy, 'reps', 12, 25)).toBe(17);
    expect(extendedTop(policy, 'reps', 12, 14)).toBe(14);
    expect(extendedTop(policy, 'reps', 22, 25)).toBe(25);
    expect(extendedTop(policy, 'reps', 25, 25)).toBe(25);
    expect(extendedTop(policy, 'reps', 30, 25)).toBe(30);
  });

  it('seconds: by fifteen, with no cap of their own', () => {
    expect(extendedTop(policy, 'duration', 60, 25)).toBe(75);
  });

  it('not at all where the axis is off', () => {
    expect(
      extendedTop({ ...policy, axes: { addSet: true, extendRange: false } }, 'reps', 12, 25),
    ).toBe(12);
  });
});

describe('T81 the axis between hold and step up', () => {
  it('the range is extended by a step first: its top is what clears a failed step', () => {
    expect(chooseIntermediateAxis(input())).toEqual({ axis: 'extend_range', hi: 13, sets: 2 });
    expect(chooseIntermediateAxis(input({ currentHi: 15 }))).toMatchObject({
      axis: 'extend_range',
      hi: 16,
    });
  });

  it('twice as fast when the person said it was too easy, but never past the extended top', () => {
    expect(chooseIntermediateAxis(input({ pace: 2 }))).toMatchObject({ hi: 14 });
    expect(chooseIntermediateAxis(input({ currentHi: 16, pace: 2 }))).toMatchObject({ hi: 17 });
  });

  it('seconds go up by five', () => {
    expect(chooseIntermediateAxis(input({ unit: 'duration', baseHi: 60, currentHi: 60 }))).toEqual({
      axis: 'extend_range',
      hi: 65,
      sets: 2,
    });
  });

  it('where the range cannot go further: one more set, if the day has room', () => {
    expect(chooseIntermediateAxis(input({ currentHi: 17 }))).toEqual({
      axis: 'add_set',
      hi: 17,
      sets: 3,
    });
    expect(chooseIntermediateAxis(input({ repCap: 12 }))).toEqual({
      axis: 'add_set',
      hi: 12,
      sets: 3,
    });
  });

  it('else hold', () => {
    expect(chooseIntermediateAxis(input({ currentHi: 17, allowedSets: 2 }))).toEqual({
      axis: 'hold',
      hi: 17,
      sets: 2,
    });
    const noSets = { ...policy, axes: { addSet: false, extendRange: true } };
    expect(chooseIntermediateAxis(input({ policy: noSets, currentHi: 17 })).axis).toBe('hold');
  });

  it('with the range axis off the extra set is the way', () => {
    const noRange = { ...policy, axes: { addSet: true, extendRange: false } };
    expect(chooseIntermediateAxis(input({ policy: noRange })).axis).toBe('add_set');
  });
});
