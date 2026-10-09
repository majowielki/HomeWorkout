/**
 * Engine v2, P3 (03 §9, T35): whether an exercise is getting anywhere.
 */
import { assess } from '../progression/assessed';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';
import { blockEvidence, improved, stalledRun } from '../progression/stall';
import { PAIRED, day, exposureOf, kg, type ExposureOptions } from './progressionFixtures';

const policy = DEFAULT_PROGRESSION_POLICY;
type Step = [date: number, mass: number, sets: (number | null)[], patch?: Partial<ExposureOptions>];
const history = (...steps: Step[]) =>
  assess(
    steps.map(([date, mass, sets, patch]) =>
      exposureOf({ date: day(date), spec: kg(mass), sets, ...patch }),
    ),
    policy,
    PAIRED,
  );
const options = { introExposures: 2, window: 3 };

describe('improved', () => {
  const [a, same, more, fewer, heavier, lighter] = history(
    [0, 4, [10, 10]],
    [2, 4, [10, 10]],
    [4, 4, [11, 10]],
    [6, 4, [9, 10]],
    [8, 6, [8, 8]],
    [10, 2, [12, 12]],
  );

  it('a harder resistance, or more at the same one', () => {
    expect(improved(a!, more!, PAIRED)).toBe(true);
    expect(improved(a!, heavier!, PAIRED)).toBe(true);
  });

  it('not the same, not less, not an easier resistance', () => {
    expect(improved(a!, same!, PAIRED)).toBe(false);
    expect(improved(a!, fewer!, PAIRED)).toBe(false);
    expect(improved(a!, lighter!, PAIRED)).toBe(false);
  });

  it('a setup that cannot be compared is a change, not a stall', () => {
    const other = exposureOf({
      date: day(12),
      spec: { ...kg(4), configurationKey: 'other' },
      sets: [10, 10],
    });
    const [b] = assess([other], policy, PAIRED);
    expect(improved(a!, b!, PAIRED)).toBe(true);
  });
});

describe('T94 how long an exercise has stood still', () => {
  it('counts the exposures in a row that did not improve on the one before', () => {
    expect(stalledRun(history([0, 4, [10, 10]], [2, 4, [10, 10]], [4, 4, [10, 10]]), PAIRED)).toBe(
      2,
    );
    expect(stalledRun(history([0, 4, [9, 9]], [2, 4, [10, 10]], [4, 4, [10, 10]]), PAIRED)).toBe(1);
    expect(stalledRun(history([0, 4, [10, 10]], [2, 4, [10, 10]], [4, 6, [8, 8]]), PAIRED)).toBe(0);
  });

  it('an exercise that has no earlier exposure to be compared with has not stood still', () => {
    expect(stalledRun([], PAIRED)).toBe(0);
    expect(stalledRun(history([0, 4, [10, 10]]), PAIRED)).toBe(0);
  });

  it('an incomplete exposure and a week of deload say nothing', () => {
    const steps: Step[] = [
      [0, 4, [10, 10]],
      [2, 4, [10, null]],
      [4, 4, [6, 6], { context: { deload: true } }],
      [6, 4, [10, 10]],
      [8, 4, [10, 10]],
    ];
    expect(stalledRun(history(...steps), PAIRED)).toBe(2);
  });
});

describe('T35 what a variant has shown in a block', () => {
  it('too few exposures to judge are not a stall', () => {
    const evidence = blockEvidence(
      history([0, 4, [10, 10]], [2, 4, [10, 10]]),
      day(0),
      PAIRED,
      options,
    );
    expect(evidence).toEqual({ qualifiedExposures: 2, progressing: true });
  });

  it('only what came in the block counts, and only what can be judged', () => {
    const steps: Step[] = [
      [0, 4, [10, 10]],
      [10, 4, [10, 10]],
      [12, 4, [10, null]],
      [14, 4, [10, 10]],
    ];
    expect(blockEvidence(history(...steps), day(10), PAIRED, options).qualifiedExposures).toBe(2);
  });

  it('flat after the first exposures: not progressing', () => {
    const flat = history([0, 4, [10, 10]], [2, 4, [10, 10]], [4, 4, [10, 10]], [6, 4, [10, 10]]);
    expect(blockEvidence(flat, day(0), PAIRED, options)).toEqual({
      qualifiedExposures: 4,
      progressing: false,
    });
  });

  it('improving among the latest: progressing', () => {
    const moving = history([0, 4, [10, 10]], [2, 4, [10, 10]], [4, 4, [10, 10]], [6, 4, [11, 10]]);
    expect(blockEvidence(moving, day(0), PAIRED, options).progressing).toBe(true);
  });

  it('an improvement older than the window does not count', () => {
    const old = history(
      [0, 4, [9, 9]],
      [2, 4, [10, 10]],
      [4, 4, [10, 10]],
      [6, 4, [10, 10]],
      [8, 4, [10, 10]],
    );
    expect(blockEvidence(old, day(0), PAIRED, options).progressing).toBe(false);
  });
});
