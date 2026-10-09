/**
 * Engine v2, P3 (03 §12, 13 §6, T81-T84): a step up that failed is remembered
 * until the person has shown more at the step below.
 */
import { assess } from '../progression/assessed';
import { failedRungMemory, type FailedRungOptions } from '../progression/failedRungs';
import { levelIdOf } from '../progression/levels';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';
import { PAIRED, day, exposureOf, kg, type ExposureOptions } from './progressionFixtures';

const id = (mass: number) => levelIdOf(PAIRED, kg(mass))!;
const options = (patch: Partial<FailedRungOptions> = {}): FailedRungOptions => ({
  asOf: day(30),
  expiryDays: 42,
  range: { lo: 8, hi: 12 },
  extendedTop: 17,
  ...patch,
});

type Step = [
  date: number,
  mass: number,
  sets: ExposureOptions['sets'],
  patch?: Partial<ExposureOptions>,
];
const history = (...steps: Step[]) =>
  assess(
    steps.map(([date, mass, sets, patch]) =>
      exposureOf({ date: day(date), spec: kg(mass), sets, ...patch }),
    ),
    DEFAULT_PROGRESSION_POLICY,
    PAIRED,
  );
const memory = (steps: Step[], patch: Partial<FailedRungOptions> = {}) =>
  failedRungMemory(history(...steps), PAIRED, options(patch));

/** 4 kg at the top, 6 kg below the range twice, back to 4 kg. */
const FAILED: Step[] = [
  [0, 4, [12, 12]],
  [1, 6, [6, 6]],
  [3, 6, [7, 6]],
  [5, 4, [12, 12]],
];

describe('T81 a step up that failed, and the person went back', () => {
  it('is remembered, with where it failed and where the person went back to', () => {
    const found = memory(FAILED);
    expect([...found.keys()]).toEqual([id(6)]);
    expect(found.get(id(6))).toEqual({
      level: id(6),
      failedOn: day(1),
      returnedTo: id(4),
      cleared: false,
      clearProgress: { topExposures: 1, axisDone: false },
    });
  });

  it('is remembered also when the person went back before the second failure', () => {
    expect(
      memory([
        [0, 4, [12, 12]],
        [1, 6, [6, 6]],
        [3, 4, [12, 12]],
      ]).has(id(6)),
    ).toBe(true);
  });

  it('is remembered when the person did the lower step although the higher was prescribed', () => {
    const found = memory([
      [0, 4, [12, 12]],
      [1, 6, [6, 6]],
      [
        3,
        6,
        [
          { amount: 12, spec: kg(4) },
          { amount: 12, spec: kg(4) },
        ],
      ],
    ]);
    expect(found.get(id(6))).toMatchObject({ returnedTo: id(4), cleared: false });
  });

  it('is nothing while the person is still on the step', () => {
    expect(memory(FAILED.slice(0, 3)).size).toBe(0);
  });

  it('is nothing when the step up held', () => {
    expect(
      memory([
        [0, 4, [12, 12]],
        [1, 6, [9, 9]],
        [3, 6, [12, 12]],
        [5, 8, [10, 10]],
      ]).size,
    ).toBe(0);
  });

  it('is nothing when the step up was kept after a failure and then a success', () => {
    expect(
      memory([
        [0, 4, [12, 12]],
        [1, 6, [6, 6]],
        [3, 6, [12, 12]],
        [5, 4, [12, 12]],
      ]).size,
    ).toBe(0);
  });

  it('is nothing when the person went up again, not back', () => {
    expect(
      memory([
        [0, 4, [12, 12]],
        [1, 6, [6, 6]],
        [3, 8, [9, 9]],
      ]).size,
    ).toBe(0);
  });

  it('is nothing when nothing was done at the higher step', () => {
    expect(
      memory([
        [0, 4, [12, 12]],
        [1, 6, [null, null]],
        [3, 4, [12, 12]],
      ]).size,
    ).toBe(0);
  });

  it('is nothing when the first exposure is the failed one: there was no step up to fail', () => {
    expect(
      memory([
        [0, 6, [6, 6]],
        [2, 4, [12, 12]],
      ]).size,
    ).toBe(0);
  });

  it('is the latest failure of a step that failed twice', () => {
    const found = memory(
      [...FAILED, [7, 4, [12, 12]], [9, 6, [5, 5]], [11, 6, [6, 6]], [13, 4, [12, 12]]],
      { asOf: day(14) },
    );
    expect(found.get(id(6))).toMatchObject({ failedOn: day(9), cleared: false });
  });
});

describe('T83 a failure that is not a failure is not remembered', () => {
  it.each([
    ['pain', { amount: 6, shortfall: 'pain' as const }],
    ['short rest', { amount: 6, shortfall: 'short_rest' as const }],
    ['soreness', { amount: 6, shortfall: 'doms' as const }],
  ])('%s', (_name, set) => {
    expect(
      memory([
        [0, 4, [12, 12]],
        [1, 6, [set, set]],
        [3, 4, [12, 12]],
      ]).size,
    ).toBe(0);
  });

  it('a failure with a set missing is no evidence', () => {
    expect(
      memory([
        [0, 4, [12, 12]],
        [1, 6, [6, null]],
        [3, 4, [12, 12]],
      ]).size,
    ).toBe(0);
  });

  it('a failure in a deload week is none', () => {
    expect(
      memory([
        [0, 4, [12, 12]],
        [1, 6, [6, 6], { context: { deload: true } }],
        [3, 4, [12, 12]],
      ]).size,
    ).toBe(0);
  });

  it('a step the model does not know moves nobody', () => {
    const odd = exposureOf({ date: day(1), spec: kg(5), sets: [6, 6] });
    const records = [
      exposureOf({ date: day(0), spec: kg(4), sets: [12, 12] }),
      odd,
      exposureOf({ date: day(3), spec: kg(4), sets: [12, 12] }),
    ];
    expect(
      failedRungMemory(assess(records, DEFAULT_PROGRESSION_POLICY, PAIRED), PAIRED, options()).size,
    ).toBe(0);
  });
});

describe('T82 the step is cleared by showing more at the step below', () => {
  it('a longer range: every set at the extended top', () => {
    const found = memory([...FAILED, [7, 4, [17, 17], { planned: { max: 17 } }]]);
    expect(found.get(id(6))).toMatchObject({
      cleared: true,
      clearProgress: { topExposures: 2, axisDone: true },
    });
  });

  it('plain top of the range does not clear it', () => {
    const found = memory([...FAILED, [7, 4, [12, 12]], [9, 4, [12, 12]]]);
    expect(found.get(id(6))).toMatchObject({
      cleared: false,
      clearProgress: { topExposures: 3, axisDone: false },
    });
  });

  it('one set short of the extended top does not clear it', () => {
    expect(
      memory([...FAILED, [7, 4, [17, 16], { planned: { max: 17 } }]]).get(id(6))!.cleared,
    ).toBe(false);
  });

  it('an exposure too hard to count, or with no effort given, does not clear it', () => {
    const hard = { amount: 17, rir: 0 };
    expect(
      memory([...FAILED, [7, 4, [hard, hard], { planned: { max: 17 } }]]).get(id(6))!.cleared,
    ).toBe(false);
    const unknown = { amount: 17, rir: null };
    expect(
      memory([...FAILED, [7, 4, [unknown, unknown], { planned: { max: 17 } }]]).get(id(6))!.cleared,
    ).toBe(false);
  });

  it('where the range cannot be extended: one more set at the top', () => {
    const cap = { extendedTop: 12 };
    expect(memory([...FAILED, [7, 4, [12, 12, 12]]], cap).get(id(6))).toMatchObject({
      cleared: true,
      clearProgress: { axisDone: true },
    });
    expect(memory([...FAILED, [7, 4, [12, 12]]], cap).get(id(6))!.cleared).toBe(false);
    expect(memory([...FAILED, [7, 4, [12, 11, 7]]], cap).get(id(6))!.cleared).toBe(false);
  });

  it('what comes after the next try of the step is not part of it', () => {
    const found = memory([...FAILED, [7, 6, [6, 6]], [9, 4, [12, 12]]]);
    expect(found.get(id(6))).toMatchObject({ failedOn: day(7), returnedTo: id(4) });
    expect(found.get(id(6))!.clearProgress.topExposures).toBe(1);
  });

  it('a lighter step is not the step it went back to', () => {
    const found = memory([...FAILED, [7, 2, [12, 12]]]);
    expect(found.get(id(6))!.clearProgress.topExposures).toBe(1);
  });
});

describe('T84 the memory fades', () => {
  it('after 42 days without an exposure at either step', () => {
    expect(memory(FAILED, { asOf: day(5 + 41) }).size).toBe(1);
    expect(memory(FAILED, { asOf: day(5 + 42) }).size).toBe(0);
  });

  it('an exposure at the lower step keeps it', () => {
    expect(memory([...FAILED, [30, 4, [12, 12]]], { asOf: day(30 + 41) }).size).toBe(1);
  });

  it('a later event of the same step replaces an old one that faded', () => {
    const found = memory([...FAILED, [100, 4, [12, 12]], [101, 6, [6, 6]], [103, 4, [12, 12]]], {
      asOf: day(110),
    });
    expect(found.get(id(6))).toMatchObject({ failedOn: day(101) });
  });

  it('an old one that faded does not come back', () => {
    const found = memory([...FAILED, [100, 4, [12, 12]], [101, 8, [6, 6]], [103, 4, [12, 12]]], {
      asOf: day(110),
    });
    expect([...found.keys()]).toEqual([id(8)]);
  });
});
