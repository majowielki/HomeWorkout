/**
 * Engine v2, P3 (03 §4-§6, §12-§17, 13 §5, 13 §20; T22-T35, T81-T92, T101-T105):
 * the pipeline of rules that turns the history of one exercise into the next
 * prescription.
 */
import { decisionTraceSchema } from '../plan/plan';
import type { SetsRecommendation } from '../plan/sets';
import { STEP_DOWN_CODES, type DecisionCode } from '../progression/codes';
import { emptyDraft, type NextInput, type RuleCtx } from '../progression/draft';
import { levelIdOf } from '../progression/levels';
import { contextOf, PIPELINE, prescribeNext, type Prescribed } from '../progression/next';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';
import { normalizeRule } from '../progression/rules';
import { RESISTANCE_REGISTRY } from '../resistance/registry';
import { addDays } from '../time/trainingDate';
import {
  BODY,
  PAIRED,
  SINGLE,
  body,
  day,
  exposureOf,
  kg,
  single,
  type ExposureOptions,
  type SetResult,
} from './progressionFixtures';

const NONE = { tier: 'none', gapDays: 2, recalibrating: false } as const;
const SETS: SetsRecommendation = {
  recommended: 2,
  allowed: [1, 3],
  advisable: [1, 10],
  reasons: [],
};

/** Everything planned in this file, to check the rules that hold for every prescription. */
const planned: { input: NextInput; result: Prescribed }[] = [];

function inputOf(history: NextInput['history'], patch: Partial<NextInput> = {}): NextInput {
  const last =
    history
      .map((r) => r.trainingDate)
      .sort()
      .at(-1) ?? day(0);
  return {
    exerciseId: 'ex',
    unit: 'reps',
    model: PAIRED,
    start: kg(4),
    range: { lo: 8, hi: 12 },
    targetRir: { min: 2, max: 3 },
    repCap: 25,
    history,
    asOf: addDays(last, 2),
    layoff: NONE,
    phase: 'work',
    eligible: true,
    sets: SETS,
    ...patch,
  };
}

function plan(history: NextInput['history'], patch: Partial<NextInput> = {}): Prescribed {
  const input = inputOf(history, patch);
  const result = prescribeNext(input);
  planned.push({ input, result });
  return result;
}

type Step = [
  date: number,
  mass: number,
  sets: (SetResult | number | null)[],
  patch?: Partial<ExposureOptions>,
];
const H = (...steps: Step[]) =>
  steps.map(([date, mass, sets, patch]) =>
    exposureOf({ date: day(date), spec: kg(mass), sets, ...patch }),
  );

/** Two exposures at the top of the range, so that nothing is an intro and a step up is due. */
const TOP4: Step[] = [
  [0, 4, [12, 12]],
  [2, 4, [12, 12]],
];

describe('03 §4 rule 1: eligibility', () => {
  it('nothing is prescribed for what may not be planned', () => {
    const { draft, trace } = plan(H(...TOP4), { eligible: false });
    expect(draft).toMatchObject({
      resistance: null,
      sets: 0,
      targets: [],
      codes: ['NOT_PRESCRIBED'],
    });
    expect(trace.code).toBe('NOT_PRESCRIBED');
  });

  it('nor in a measure the model cannot count', () => {
    const reps = {
      ...PAIRED,
      capabilities: { ...PAIRED.capabilities, quantityKinds: ['reps' as const] },
    };
    const { draft } = plan([], { model: reps, unit: 'duration' });
    expect(draft).toMatchObject({ resistance: null, codes: ['MODEL_NOT_APPLICABLE'] });
  });
});

describe('03 §4 rule 3: the first exposure', () => {
  it('starts at the start of the slot, at the bottom of the range, easy', () => {
    const { draft, trace } = plan([]);
    expect(draft).toMatchObject({
      resistance: kg(4),
      targets: [8, 8],
      sets: 2,
      targetRir: { min: 4, max: 4 },
      axis: 'calibration',
      decision: 'start',
      confidence: 'low',
      codes: ['FIRST_COMPARABLE_EXPOSURE'],
    });
    expect(trace.code).toBe('FIRST_COMPARABLE_EXPOSURE');
  });

  it('an exposure with nothing done is not a history', () => {
    expect(plan(H([0, 4, [null, null]])).draft.codes).toEqual(['FIRST_COMPARABLE_EXPOSURE']);
  });

  it('with no start there is nothing to prescribe', () => {
    expect(plan([], { start: null }).draft).toMatchObject({
      resistance: null,
      codes: ['NOT_PRESCRIBED'],
    });
  });

  it('a start the model does not know is refused at the end', () => {
    const odd = { ...kg(4), value: { kind: 'ordinal' as const, levelId: 'x' } };
    expect(plan([], { start: odd }).draft).toMatchObject({
      resistance: null,
      sets: 0,
      codes: ['FIRST_COMPARABLE_EXPOSURE', 'MODEL_NOT_APPLICABLE'],
    });
  });
});

describe('03 §4 rule 2: pain', () => {
  it('stops everything: no step in either direction (T31)', () => {
    const { draft } = plan(H(...TOP4, [4, 4, [12, { amount: 12, shortfall: 'pain' }]]));
    expect(draft).toMatchObject({ resistance: kg(4), decision: 'hold', codes: ['PAIN_REPORTED'] });
    expect(draft.maxHarder).toEqual(kg(4));
  });

  it('pain in an exposure the person has since done without it is over', () => {
    const { draft } = plan(
      H([0, 4, [12, { amount: 8, shortfall: 'pain' }]], [2, 4, [12, 12]], [4, 4, [12, 12]]),
    );
    expect(draft.codes).not.toContain('PAIN_REPORTED');
  });
});

describe('T22 a step up', () => {
  it('a small step is taken: the bottom of the range at the next resistance', () => {
    const history = [16, 16].map((m, i) =>
      exposureOf({ date: day(i * 2), spec: single(m), sets: [12, 12] }),
    );
    const { draft, trace } = plan(history, { model: SINGLE, start: single(8) });
    expect(draft).toMatchObject({
      resistance: single(18),
      targets: [8, 8],
      decision: 'advance',
      codes: ['LOAD_STEP_UP'],
      sets: 2,
    });
    expect((trace.evidence as { rules: unknown[] }).rules).toContainEqual({
      rule: 'success',
      codes: ['LOAD_STEP_UP'],
      final: true,
    });
  });

  it('a big one is tried with a probe first (T88)', () => {
    const { draft } = plan(H(...TOP4));
    expect(draft).toMatchObject({
      resistance: kg(4),
      probe: { resistance: kg(6), target: 8 },
      sets: 1,
      targets: [12],
      codes: ['PROBE_PLANNED'],
      decision: 'probe',
    });
  });

  it('a probe needs room for two sets, or the exposure holds', () => {
    const { draft } = plan(H(...TOP4), { sets: { ...SETS, recommended: 1, allowed: [1, 1] } });
    expect(draft).toMatchObject({ probe: null, codes: ['NO_ROOM_FOR_PROBE'], decision: 'hold' });
  });

  it('a probe takes a set of a longer exposure too', () => {
    const { draft } = plan(H(...TOP4), { sets: { ...SETS, recommended: 3 } });
    expect(draft).toMatchObject({ sets: 2, probe: { resistance: kg(6) } });
  });

  it('a band nobody measured is always a probe, however small the step (T91)', () => {
    const made = RESISTANCE_REGISTRY.create({ id: 'band.long', parameters: { romCm: 40 } });
    if (!made.ok) throw new Error('band model');
    const levels = made.model.levels();
    const band = (i: number) => ({
      ...kg(4),
      modelId: 'band.long',
      equipmentInstanceIds: [],
      value: levels[i]!.value,
    });
    const history = [0, 2].map((d) => exposureOf({ date: day(d), spec: band(0), sets: [12, 12] }));
    const { draft } = plan(history, { model: made.model, start: band(0) });
    expect(draft).toMatchObject({
      resistance: band(0),
      probe: { resistance: band(1) },
      codes: ['PROBE_PLANNED'],
    });
  });
});

describe('T89, T90 what the probe showed', () => {
  const probe = (amount: number): SetResult => ({
    amount,
    spec: kg(6),
    planned: { role: 'probe', requiredForProgression: false, resistance: kg(6) },
  });

  it('passed: the whole exposure goes to the new step', () => {
    const { draft } = plan(H(...TOP4, [4, 4, [probe(10), 12]]));
    expect(draft).toMatchObject({
      resistance: kg(6),
      targets: [8, 8],
      codes: ['PROBE_PASSED'],
      decision: 'advance',
    });
  });

  it('passed, but the work sets were weak: judged as they are', () => {
    const { draft } = plan(H(...TOP4, [4, 4, [probe(10), 6]]));
    expect(draft.codes).not.toContain('PROBE_PASSED');
    expect(draft.resistance).toEqual(kg(4));
  });

  it('passed, but the person was confounded: held', () => {
    const { draft } = plan(
      H(...TOP4, [4, 4, [probe(10), { amount: 12, shortfall: 'short_rest' }]]),
    );
    expect(draft.codes).toEqual(['CONTEXT_CONFOUNDED']);
  });

  it('failed: no regress, the range is lengthened and the next probe waits for two exposures', () => {
    const failed = H(...TOP4, [4, 4, [probe(4), 12]]);
    const { draft } = plan(failed);
    expect(draft).toMatchObject({
      resistance: kg(4),
      range: { lo: 8, hi: 13 },
      targets: [13, 13],
      axis: 'extend_range',
      codes: ['PROBE_FAILED', 'PROBE_COOLDOWN'],
    });
    expect(draft.codes).not.toContain('LOAD_STEP_DOWN');

    const one = plan([...failed, ...H([6, 4, [13, 13], { planned: { max: 13 } }])]).draft;
    expect(one).toMatchObject({ codes: ['PROBE_COOLDOWN'], range: { hi: 14 } });

    const two = plan([
      ...failed,
      ...H([6, 4, [13, 13], { planned: { max: 13 } }], [8, 4, [14, 14], { planned: { max: 14 } }]),
    ]).draft;
    expect(two).toMatchObject({ codes: ['PROBE_PLANNED'], probe: { resistance: kg(6) } });
  });
});

describe('T81, T82, T84 a step that failed is not offered again at once', () => {
  const FAILED: Step[] = [
    [0, 4, [12, 12]],
    [2, 6, [6, 6]],
    [4, 6, [7, 6]],
    [6, 4, [12, 12]],
  ];

  it('the range is lengthened instead of the step', () => {
    const { draft } = plan(H(...FAILED));
    expect(draft).toMatchObject({
      resistance: kg(4),
      range: { lo: 8, hi: 13 },
      targets: [13, 13],
      axis: 'extend_range',
      codes: ['RUNG_RECENTLY_FAILED'],
    });
  });

  it('one more set when the range cannot be lengthened', () => {
    const { draft } = plan(H(...FAILED), { repCap: 12 });
    expect(draft).toMatchObject({
      axis: 'add_set',
      sets: 3,
      targets: [12, 12, 12],
      codes: ['RUNG_RECENTLY_FAILED'],
    });
  });

  it('hold when there is room for neither', () => {
    const { draft } = plan(H(...FAILED), { repCap: 12, sets: { ...SETS, allowed: [1, 2] } });
    expect(draft).toMatchObject({ axis: 'none', sets: 2, codes: ['RUNG_RECENTLY_FAILED'] });
  });

  it('the longer range goes on while it is not met', () => {
    const { draft } = plan(H(...FAILED, [8, 4, [13, 13], { planned: { max: 13 } }]));
    expect(draft).toMatchObject({ range: { hi: 14 }, targets: [14, 14] });
  });

  it('twice as fast when the person said it was too easy', () => {
    const { draft } = plan(
      H(...FAILED, [8, 4, [13, 13], { planned: { max: 13 }, context: { feel: 'too_easy' } }]),
    );
    expect(draft.range.hi).toBe(15);
  });

  it('shown more at the lower step: the step is offered again, with a probe', () => {
    const { draft } = plan(H(...FAILED, [8, 4, [17, 17], { planned: { max: 17 } }]));
    expect(draft).toMatchObject({
      resistance: kg(4),
      probe: { resistance: kg(6) },
      codes: ['PROBE_PLANNED'],
    });
  });

  it('forgotten after 42 days without an exposure at either step', () => {
    const at = (asOf: string) => contextOf(inputOf(H(...FAILED), { asOf })).failed.size;
    expect(at(day(6 + 41))).toBe(1);
    expect(at(day(6 + 42))).toBe(0);
  });
});

describe('T22-T25 holding where the evidence does not allow a step', () => {
  it('T24 at the top, but the effort was less than asked: hold at the top', () => {
    const { draft } = plan(H([0, 4, [12, 12]], [2, 4, [{ amount: 12, rir: 0 }, 12]]));
    expect(draft).toMatchObject({ resistance: kg(4), targets: [12, 12], codes: ['RIR_TOO_LOW'] });
  });

  it('T23 nobody said how hard: hold, and say what is missing', () => {
    const { draft } = plan(H(...TOP4, [4, 4, [12, { amount: 12, rir: null }]]));
    expect(draft).toMatchObject({
      resistance: kg(4),
      decision: 'hold',
      codes: ['MISSING_EFFORT_EVIDENCE'],
    });
  });

  it('T27 done at another resistance than planned: held where the person was', () => {
    const { draft } = plan([
      ...H(...TOP4),
      exposureOf({
        date: day(4),
        spec: kg(6),
        sets: [
          { amount: 11, spec: kg(4) },
          { amount: 12, spec: kg(4) },
        ],
      }),
    ]);
    expect(draft).toMatchObject({
      resistance: kg(4),
      targets: [11, 12],
      codes: ['PRESCRIPTION_DEVIATION'],
    });
  });

  it('T10 a missing side is named, and the recipe repeated', () => {
    const sides = exposureOf({ date: day(4), spec: kg(4), sets: [12, 12], sides: true });
    sides.sets[3] = { ...sides.sets[3]!, disposition: 'skipped', observation: null };
    const { draft } = plan([...H(...TOP4), sides]);
    expect(draft).toMatchObject({
      resistance: kg(4),
      targets: [12, 12],
      codes: ['INCOMPLETE_PLANNED_SETS', 'MISSING_SIDE'],
    });
  });

  it('T31 a set cut short by a short rest or sore muscles does not count', () => {
    const { draft } = plan(H(...TOP4, [4, 4, [12, { amount: 6, shortfall: 'doms' }]]));
    expect(draft.codes).toEqual(['CONTEXT_CONFOUNDED']);
  });

  it('T71 a shortened exposure: held, no failure, and the feeling is kept', () => {
    const { draft } = plan(
      H(...TOP4, [4, 4, [12, 12], { context: { userReduced: true, feel: 'too_hard' } }]),
    );
    expect(draft.codes).toEqual(['USER_REDUCED', 'FEEL_TOO_HARD']);
    expect(draft.resistance).toEqual(kg(4));
  });

  it('only a week of deload to go on: held', () => {
    const { draft } = plan(H([0, 4, [12, 12], { context: { deload: true } }]));
    expect(draft.codes).toEqual(['CONTEXT_CONFOUNDED', 'INTRO_EXPOSURE']);
  });

  it('a week of deload between is not read: the exposure before it decides', () => {
    const { draft } = plan(H(...TOP4, [4, 4, [6, 6], { context: { deload: true } }]));
    expect(draft.codes).toEqual(['PROBE_PLANNED']);
  });
});

describe('13 §15: the feeling the person reported', () => {
  it('too hard at the top: no step yet', () => {
    const { draft } = plan(H(...TOP4, [4, 4, [12, 12], { context: { feel: 'too_hard' } }]));
    expect(draft).toMatchObject({ resistance: kg(4), targets: [12, 12], codes: ['FEEL_TOO_HARD'] });
  });

  it('too easy at the top: noted with the step', () => {
    const history = [16, 16, 16].map((m, i) =>
      exposureOf({
        date: day(i * 2),
        spec: single(m),
        sets: [12, 12],
        context: i === 2 ? { feel: 'too_easy' } : {},
      }),
    );
    const { draft } = plan(history, { model: SINGLE, start: single(8) });
    expect(draft.codes).toEqual(['LOAD_STEP_UP', 'FEEL_TOO_EASY']);
  });

  it('too easy inside the range: twice the step', () => {
    const { draft } = plan(H([0, 4, [10, 9]], [2, 4, [10, 9], { context: { feel: 'too_easy' } }]));
    expect(draft).toMatchObject({ targets: [12, 11], codes: ['REP_PROGRESSION', 'FEEL_TOO_EASY'] });
  });
});

describe('T86 untouched suggestions ask before a step up', () => {
  const unattended: SetResult = { amount: 12, suggested: true, confirmation: 'visible' };
  const asleep = H([0, 4, [unattended, unattended]], [2, 4, [unattended, unattended]]);

  it('two exposures of nothing but the suggestions: a question', () => {
    const { draft } = plan(asleep);
    expect(draft).toMatchObject({
      resistance: kg(4),
      codes: ['CONFIRM_STEP_UP'],
      decision: 'hold',
    });
    expect(draft.proposals).toEqual([
      { kind: 'confirm_step_up', to: kg(6), code: 'CONFIRM_STEP_UP' },
    ]);
  });

  it('"yes" is the step; "not yet" is a hold that remembers it', () => {
    expect(plan(asleep, { user: { stepUp: 'yes' } }).draft.codes).toEqual(['PROBE_PLANNED']);
    expect(plan(asleep, { user: { stepUp: 'no' } }).draft.codes).toEqual(['USER_DEFERRED']);
  });

  it('one exposure where the person did something is enough', () => {
    const { draft } = plan(H([0, 4, [unattended, unattended]], [2, 4, [12, 12]]));
    expect(draft.codes).toEqual(['PROBE_PLANNED']);
  });
});

describe('T98 the top of the ladder', () => {
  const TOP10: Step[] = [
    [0, 10, [12, 12]],
    [2, 10, [12, 12]],
  ];

  it('at the top, but too hard: hold, as anywhere', () => {
    const { draft } = plan(H([0, 10, [12, 12]], [2, 10, [{ amount: 12, rir: 0 }, 12]]));
    expect(draft).toMatchObject({ resistance: kg(10), range: { hi: 12 }, codes: ['RIR_TOO_LOW'] });
  });

  it('LOAD_CEILING with a longer range, and no set added', () => {
    const { draft } = plan(H([0, 10, [12, 11]], [2, 10, [12, 12]]));
    expect(draft).toMatchObject({
      resistance: kg(10),
      range: { lo: 8, hi: 13 },
      axis: 'extend_range',
      codes: ['LOAD_CEILING'],
      sets: 2,
    });
  });

  it('two exposures at the top: a harder variant is put to the person', () => {
    const { draft } = plan(H(...TOP10), { variants: { harder: 'archer', easier: null } });
    expect(draft.codes).toEqual(['LOAD_CEILING', 'VARIANT_UP_SUGGESTED']);
    expect(draft.proposals).toEqual([
      { kind: 'variant_up', to: 'archer', code: 'VARIANT_UP_SUGGESTED' },
    ]);
    expect(plan(H(...TOP10)).draft.proposals).toEqual([]);
  });

  it('T98 the cap of reps: REP_CAP_REACHED, and the variant', () => {
    const capped = H(
      [0, 10, [14, 14], { planned: { max: 14 } }],
      [2, 10, [14, 14], { planned: { max: 14 } }],
    );
    const { draft } = plan(capped, { repCap: 14, variants: { harder: 'archer', easier: null } });
    expect(draft.codes).toEqual(['LOAD_CEILING', 'REP_CAP_REACHED', 'VARIANT_UP_SUGGESTED']);
    expect(draft.range.hi).toBe(14);
    expect(plan(capped, { repCap: 14 }).draft.codes).toEqual(['LOAD_CEILING', 'REP_CAP_REACHED']);
  });

  it('a hold is lengthened in seconds, without a cap', () => {
    const history = [0, 2].map((d) =>
      exposureOf({ date: day(d), spec: body, sets: [60, 60], seconds: true }),
    );
    const { draft } = plan(history, {
      model: BODY,
      start: body,
      unit: 'duration',
      range: { lo: 20, hi: 60 },
    });
    expect(draft).toMatchObject({ range: { hi: 65 }, targets: [65, 65], codes: ['LOAD_CEILING'] });
  });
});

describe('T29, T30 a step down after failures that count', () => {
  const fail6 = (
    date: number,
    sets: (SetResult | number | null)[] = [6, 5],
    patch: Partial<ExposureOptions> = {},
  ): Step => [date, 6, sets, patch];

  it('two failures in a row at one step: one step easier, bottom of the range', () => {
    const { draft } = plan(H(fail6(0), fail6(2)));
    expect(draft).toMatchObject({
      resistance: kg(4),
      targets: [8, 8],
      decision: 'regress',
      codes: ['LOAD_STEP_DOWN'],
    });
  });

  it('one failure: the same step and a little more', () => {
    const { draft } = plan(H([0, 6, [12, 12]], fail6(2)));
    expect(draft).toMatchObject({ resistance: kg(6), targets: [8, 8], codes: ['REP_PROGRESSION'] });
  });

  it('a skipped exposure between breaks the run', () => {
    const { draft } = plan(H(fail6(0), [2, 6, [null, null]], fail6(4)));
    expect(draft.resistance).toEqual(kg(6));
    expect(draft.codes).toEqual(['REP_PROGRESSION']);
  });

  it('so does another step, a deload week, another range and a day of short rest', () => {
    expect(plan(H([0, 8, [6, 5]], fail6(2))).draft.codes).toEqual(['REP_PROGRESSION']);
    expect(plan(H(fail6(0), fail6(2, [6, 5], { context: { deload: true } }))).draft.codes).toEqual([
      'REP_PROGRESSION',
    ]);
    expect(plan(H(fail6(0, [6, 5], { range: { lo: 6, hi: 12 } }), fail6(2))).draft.codes).toEqual([
      'REP_PROGRESSION',
    ]);
    expect(
      plan(H(fail6(0), fail6(2, [6, { amount: 5, shortfall: 'short_rest' }]))).draft.codes,
    ).toEqual(['CONTEXT_CONFOUNDED']);
  });
});

describe('T101-T103 building up where nothing is easier', () => {
  const crunch = (
    date: number,
    sets: (SetResult | number | null)[],
    patch: Partial<ExposureOptions> = {},
  ) => exposureOf({ date: day(date), spec: body, sets, ...patch });
  const build = (history: ReturnType<typeof crunch>[], patch: Partial<NextInput> = {}) =>
    plan(history, { model: BODY, start: body, ...patch });

  it('T101 from what was done plus a step; no regression and no failure', () => {
    const { draft } = build([crunch(0, [4, 4]), crunch(2, [5, 4])]);
    expect(draft).toMatchObject({
      resistance: body,
      targets: [6, 5],
      decision: 'build_up',
      codes: ['AT_MINIMUM', 'BUILDUP_BELOW_RANGE'],
    });
    expect(draft.codes).not.toContain('LOAD_STEP_DOWN');
  });

  it('a set done to the limit is repeated', () => {
    const { draft } = build([crunch(0, [5, 4]), crunch(2, [5, { amount: 4, rir: 0 }])]);
    expect(draft.targets).toEqual([6, 4]);
  });

  it('once every set reaches the bottom of the range it is the ordinary progression', () => {
    const { draft } = build([crunch(0, [5, 4]), crunch(2, [8, 8])]);
    expect(draft).toMatchObject({ targets: [9, 9], codes: ['REP_PROGRESSION'] });
  });

  it('T102 a hold is built in seconds, and so is the lightest dumbbell', () => {
    const plank = [12, 15].map((s, i) =>
      exposureOf({ date: day(i * 2), spec: body, sets: [s, s], seconds: true }),
    );
    const { draft } = build(plank, { unit: 'duration', range: { lo: 20, hi: 60 } });
    expect(draft).toMatchObject({
      targets: [20, 20],
      codes: ['AT_MINIMUM', 'BUILDUP_BELOW_RANGE'],
    });

    const light = [0, 2].map((d) => exposureOf({ date: day(d), spec: kg(2), sets: [5, 4] }));
    const dumbbell = plan(light, { start: kg(2) }).draft;
    expect(dumbbell).toMatchObject({ resistance: kg(2), targets: [6, 5], decision: 'build_up' });
  });

  it('T103 far under the range: an easier variant is put to the person', () => {
    const { draft } = build([crunch(0, [3, 3]), crunch(2, [3, 3])], {
      variants: { harder: null, easier: 'dead-bug' },
    });
    expect(draft.proposals).toEqual([
      { kind: 'variant_down', to: 'dead-bug', code: 'VARIANT_DOWN_SUGGESTED' },
    ]);
    expect(draft.codes).toEqual(['AT_MINIMUM', 'BUILDUP_BELOW_RANGE', 'VARIANT_DOWN_SUGGESTED']);
  });

  it('standing still does the same; improving does not', () => {
    const still = build([crunch(0, [5, 4]), crunch(2, [5, 4])], {
      variants: { harder: null, easier: 'dead-bug' },
    });
    expect(still.draft.proposals).toHaveLength(1);
    const better = build([crunch(0, [5, 4]), crunch(2, [6, 4])], {
      variants: { harder: null, easier: 'dead-bug' },
    });
    expect(better.draft.proposals).toEqual([]);
  });

  it('without an easier variant: said so, and the build goes on', () => {
    const { draft } = build([crunch(0, [3, 3]), crunch(2, [3, 3])]);
    expect(draft.codes).toEqual(['AT_MINIMUM', 'BUILDUP_BELOW_RANGE', 'NO_EASIER_VARIANT']);
    expect(draft.targets).toEqual([4, 4]);
  });

  it('"not now" is kept: no new proposal until the build stands still again', () => {
    const history = [crunch(0, [3, 3]), crunch(2, [3, 3])];
    const variants = { harder: null, easier: 'dead-bug' };
    expect(
      build(history, { variants, user: { variantDownDeferredAt: day(2) } }).draft.proposals,
    ).toEqual([]);
    const later = [...history, crunch(4, [3, 3]), crunch(6, [3, 3])];
    expect(
      build(later, { variants, user: { variantDownDeferredAt: day(2) } }).draft.proposals,
    ).toHaveLength(1);
  });

  it('pain comes before a build (10 §5)', () => {
    const { draft } = build([crunch(0, [5, 4]), crunch(2, [5, { amount: 4, shortfall: 'pain' }])]);
    expect(draft.codes).toEqual(['PAIN_REPORTED']);
    expect(draft.targets).toEqual([12, 12]);
  });
});

describe('03 §5: inside the range', () => {
  it('each set a step further, the weaker one first', () => {
    const { draft } = plan(H([0, 4, [12, 10]], [2, 4, [12, 10]]));
    expect(draft).toMatchObject({
      targets: [12, 11],
      codes: ['REP_PROGRESSION'],
      resistance: kg(4),
    });
  });

  it('a set that took everything is not asked for more', () => {
    const { draft } = plan(H([0, 4, [10, 9]], [2, 4, [10, { amount: 9, rir: 0 }]]));
    expect(draft.targets).toEqual([11, 9]);
  });
});

describe('T33, T34 coming back', () => {
  const layoff = (
    tier: 'short' | 'medium' | 'long',
    gapDays: number,
    recalibrating = tier === 'long',
  ) => ({
    tier,
    gapDays,
    recalibrating,
  });

  it('a short break repeats the last recipe', () => {
    const { draft } = plan(H(...TOP4), { asOf: day(2 + 9), layoff: layoff('short', 9) });
    expect(draft).toMatchObject({ resistance: kg(4), targets: [12, 12], codes: ['LAYOFF_REPEAT'] });
  });

  it('a medium one a step down, or the same where there is none', () => {
    const medium = plan(H(...TOP4), { asOf: day(2 + 16), layoff: layoff('medium', 16) }).draft;
    expect(medium).toMatchObject({
      resistance: kg(2),
      targets: [8, 8],
      codes: ['LAYOFF_STEP_DOWN'],
    });
    const lightest = plan(H([0, 2, [12, 12]], [2, 2, [12, 12]]), {
      asOf: day(2 + 16),
      layoff: layoff('medium', 16),
    }).draft;
    expect(lightest).toMatchObject({ resistance: kg(2), codes: ['LAYOFF_REPEAT'] });
    expect(lightest.codes).not.toContain('LAYOFF_STEP_DOWN');
  });

  it('a long one, or an exercise not done for a month: re-exposure, easy', () => {
    const long = plan(H(...TOP4), { asOf: day(2 + 40), layoff: layoff('long', 40) });
    expect(long.draft).toMatchObject({
      resistance: kg(2),
      targets: [8, 8],
      targetRir: { min: 4, max: 4 },
      confidence: 'low',
      codes: ['RE_EXPOSURE', 'RECALIBRATION'],
    });
    expect(long.trace.evidence).toMatchObject({ clock: 'global', gapDays: 40 });

    const rotated = plan(H(...TOP4), { asOf: day(2 + 31) });
    expect(rotated.draft.codes).toEqual(['RE_EXPOSURE']);
    expect(rotated.trace.evidence).toMatchObject({ clock: 'exercise' });
  });

  it('T34 an exercise that comes back after half a year has a past', () => {
    const { draft } = plan(H(...TOP4), { asOf: day(2 + 180), layoff: layoff('long', 180) });
    expect(draft.codes).not.toContain('FIRST_COMPARABLE_EXPOSURE');
    expect(draft.codes[0]).toBe('RE_EXPOSURE');
  });

  it('T33 the same snapshot twice is the same decision, and what was done ends it', () => {
    const history = H(...TOP4);
    const options = { asOf: day(2 + 40), layoff: layoff('long', 40) };
    expect(plan(history, options).draft).toEqual(plan(history, options).draft);
    const done = [...history, ...H([42, 2, [12, 12]], [44, 2, [12, 12]])];
    expect(plan(done, { asOf: day(46) }).draft.codes).not.toContain('RE_EXPOSURE');
  });
});

describe('T32 the phase and the break', () => {
  it('a deload week repeats the last recipe, easy, and does not go up', () => {
    const { draft } = plan(H(...TOP4), { phase: 'deload', sets: { ...SETS, recommended: 1 } });
    expect(draft).toMatchObject({
      resistance: kg(4),
      targets: [12],
      targetRir: { min: 4, max: 5 },
      decision: 'deload',
      codes: ['DELOAD'],
    });
    expect(draft.maxHarder).toEqual(kg(4));
  });

  it('a break and a deload at once: the step down of the break, the effort of the deload', () => {
    const { draft } = plan(H(...TOP4), {
      phase: 'deload',
      asOf: day(2 + 16),
      layoff: { tier: 'medium', gapDays: 16, recalibrating: false },
    });
    expect(draft).toMatchObject({
      resistance: kg(2),
      targetRir: { min: 4, max: 5 },
      codes: ['LAYOFF_STEP_DOWN', 'DELOAD'],
    });
  });

  it('the sessions after a long break are easy and do not go up', () => {
    const { draft } = plan(H(...TOP4), {
      layoff: { tier: 'none', gapDays: 2, recalibrating: true },
    });
    expect(draft).toMatchObject({
      resistance: kg(4),
      targets: [12, 12],
      targetRir: { min: 4, max: 4 },
      codes: ['RECALIBRATION'],
    });
  });

  it('the first two exposures are easy', () => {
    const { draft } = plan(H([0, 4, [10, 9]]));
    expect(draft).toMatchObject({ targetRir: { min: 4, max: 4 }, confidence: 'low' });
    expect(draft.codes).toEqual(['REP_PROGRESSION', 'INTRO_EXPOSURE']);
  });
});

describe('12 §5: the sets of the next exposure', () => {
  it('are the policy’s unless an axis asked for another number', () => {
    expect(plan(H(...TOP4), { sets: { ...SETS, recommended: 3 } }).draft.sets).toBe(2);
    expect(
      plan(H([0, 4, [10, 9]], [2, 4, [10, 9]]), { sets: { ...SETS, recommended: 3 } }).draft.sets,
    ).toBe(3);
  });

  it('no room: nothing to do today', () => {
    const { draft } = plan(H([0, 4, [10, 9]], [2, 4, [10, 9]]), {
      sets: { recommended: 0, allowed: null, advisable: [1, 10], reasons: ['NO_ROOM'] },
    });
    expect(draft).toMatchObject({ sets: 0, targets: [] });
  });
});

describe('the shadow estimator', () => {
  it('writes into the trace and changes nothing else', () => {
    const history = H(...TOP4);
    const without = plan(history);
    const estimator = (ctx: RuleCtx) => ({
      kind: 'unknown' as const,
      reasons: [`${ctx.usable.length} exposures`],
    });
    const shadow = plan(history, { estimator });
    expect(shadow.draft.evidence).toMatchObject({
      shadow: { kind: 'unknown', reasons: ['2 exposures'] },
    });
    expect({ ...shadow.draft, evidence: {} }).toEqual({ ...without.draft, evidence: {} });
  });
});

describe('the pipeline itself', () => {
  it('rules after a settled draft do not run, except those that always do', () => {
    const { trace } = plan([], { eligible: false });
    const rules = (trace.evidence as { rules: { rule: string }[] }).rules.map((r) => r.rule);
    expect(rules).toEqual(['eligibility', 'sets', 'normalize']);
  });

  it('a pipeline is a list: leave a rule out and it is not applied', () => {
    const history = H(...TOP4);
    const { draft } = prescribeNext(
      {
        exerciseId: 'ex',
        unit: 'reps',
        model: PAIRED,
        start: kg(4),
        range: { lo: 8, hi: 12 },
        targetRir: { min: 2, max: 3 },
        repCap: 25,
        history,
        asOf: day(4),
        layoff: NONE,
        phase: 'work',
        eligible: false,
        sets: SETS,
      },
      PIPELINE.filter((r) => r.id !== 'eligibility'),
    );
    expect(draft.codes).toEqual(['PROBE_PLANNED']);
  });

  it('a probe the model does not know is dropped by the last check', () => {
    const odd = { ...kg(6), value: { kind: 'ordinal' as const, levelId: 'x' } };
    const ctx = contextOf(inputOf([]));
    const draft = normalizeRule.apply(ctx, {
      ...emptyDraft(ctx),
      resistance: kg(4),
      targets: [8],
      sets: 1,
      probe: { resistance: odd, target: 8 },
    });
    expect(draft.probe).toBeNull();
    expect(draft.resistance).toEqual(kg(4));
  });
});

describe('what holds for every prescription made above (T56, T105)', () => {
  it('every one has a code, a trace the plan schema accepts, and targets for each set', () => {
    expect(planned.length).toBeGreaterThan(50);
    for (const { input, result } of planned) {
      const { draft, trace } = result;
      expect(decisionTraceSchema.safeParse(trace).success).toBe(true);
      expect(DEFAULT_PROGRESSION_POLICY.id).toBe(trace.policy.id);
      expect(draft.codes.length).toBeGreaterThan(0);
      expect(draft.targets).toHaveLength(draft.sets ?? -1);
      expect(input.range.lo).toBeLessThanOrEqual(input.range.hi);
    }
  });

  it('T105 a code that says “easier” is only given when the resistance really is', () => {
    for (const { input, result } of planned) {
      const ctx = contextOf(input);
      const { draft } = result;
      if (draft.codes.some((c) => STEP_DOWN_CODES.includes(c as DecisionCode))) {
        const before = ctx.last?.at;
        expect(before).toBeDefined();
        expect(levelIdOf(input.model, draft.resistance!)).not.toBe(levelIdOf(input.model, before!));
        expect(input.model.compare(draft.resistance!.value, before!.value)).toBe('easier');
      }
    }
  });

  it('nothing is prescribed harder than the last exposure unless a step up says so', () => {
    for (const { input, result } of planned) {
      const ctx = contextOf(input);
      const { draft } = result;
      if (ctx.last === null || draft.resistance === null) continue;
      if (input.model.compare(draft.resistance.value, ctx.last.at!.value) === 'harder') {
        expect(draft.codes.some((c) => c === 'LOAD_STEP_UP' || c === 'PROBE_PASSED')).toBe(true);
      }
    }
  });

  it('T56 the order of the records does not matter', () => {
    for (const { input, result } of planned.filter((p) => p.input.history.length > 1)) {
      const shuffled = { ...input, history: [...input.history].reverse() };
      expect(prescribeNext(shuffled).draft).toEqual(result.draft);
    }
  });
});
