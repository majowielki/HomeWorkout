/**
 * Engine v2, P3: the pipeline where the main suite does not go — no room for
 * a set, a plan that asked for no effort, a cleared step, an exercise at the
 * lightest resistance coming back, and a pipeline missing its rules.
 */
import { assess } from '../progression/assessed';
import type { NextInput } from '../progression/draft';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';
import { PIPELINE, prescribeNext } from '../progression/next';
import { probeVerdict } from '../progression/probe';
import { normalizeRule, setsRule } from '../progression/rules';
import { addDays } from '../time/trainingDate';
import {
  PAIRED,
  day,
  exposureOf,
  kg,
  type ExposureOptions,
  type SetResult,
} from './progressionFixtures';

const SETS = {
  recommended: 2,
  allowed: [1, 3] as [number, number],
  advisable: [1, 10] as [number, number],
  reasons: [],
};

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
    layoff: { tier: 'none', gapDays: 2, recalibrating: false },
    phase: 'work',
    eligible: true,
    sets: SETS,
    ...patch,
  };
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
const next = (history: NextInput['history'], patch: Partial<NextInput> = {}) =>
  prescribeNext(inputOf(history, patch)).draft;

const TOP4: Step[] = [
  [0, 4, [12, 12]],
  [2, 4, [12, 12]],
];
const NO_ROOM = {
  recommended: 0,
  allowed: null,
  advisable: [1, 10] as [number, number],
  reasons: ['NO_ROOM' as const],
};

describe('no room for a set today', () => {
  it('a step up is not tried: a probe needs two sets', () => {
    expect(next(H(...TOP4), { sets: NO_ROOM })).toMatchObject({
      codes: ['NO_ROOM_FOR_PROBE'],
      sets: 0,
    });
  });

  it('a failed step is held, with neither a longer range nor an extra set to give', () => {
    const failed = H([0, 4, [12, 12]], [2, 6, [6, 6]], [4, 6, [7, 6]], [6, 4, [12, 12]]);
    expect(next(failed, { sets: NO_ROOM, repCap: 12 })).toMatchObject({
      axis: 'none',
      codes: ['RUNG_RECENTLY_FAILED'],
    });
  });
});

describe('a plan that asked for no effort', () => {
  it('is progressed by the range alone', () => {
    const history = H(
      [0, 4, [10, 9], { targetRir: null }],
      [2, 4, [10, { amount: 9, rir: 0 }], { targetRir: null }],
    );
    expect(next(history)).toMatchObject({ targets: [11, 10], codes: ['REP_PROGRESSION'] });
  });
});

describe('a step that was cleared', () => {
  it('no longer keeps the range long: a hold goes back to the range of the slot', () => {
    const cleared = H(
      [0, 4, [12, 12]],
      [2, 6, [6, 6]],
      [4, 6, [7, 6]],
      [6, 4, [12, 12]],
      [8, 4, [17, 17], { planned: { max: 17 } }],
      [10, 4, [12, null]],
    );
    const draft = next(cleared);
    expect(draft).toMatchObject({ codes: ['INCOMPLETE_PLANNED_SETS'], range: { hi: 12 } });
    expect(draft.targets).toEqual([12, 12]);
  });
});

describe('an exercise at its lightest resistance, away for a month', () => {
  it('comes back where it was, easy', () => {
    const draft = next(H([0, 2, [12, 12]], [2, 2, [12, 12]]), { asOf: day(2 + 31) });
    expect(draft).toMatchObject({
      resistance: kg(2),
      codes: ['RE_EXPOSURE'],
      targetRir: { min: 4, max: 4 },
    });
  });
});

describe('a probe in seconds', () => {
  it('is judged against the bottom of the time range', () => {
    const probe: SetResult = {
      amount: 30,
      spec: kg(6),
      planned: { role: 'probe', requiredForProgression: false, resistance: kg(6) },
    };
    const rec = exposureOf({ date: day(0), spec: kg(4), sets: [probe, 60], seconds: true });
    const [a] = assess([rec], DEFAULT_PROGRESSION_POLICY, PAIRED);
    expect(probeVerdict(a!, PAIRED)).toBe('passed');
    const [short] = assess(
      [
        exposureOf({
          date: day(0),
          spec: kg(4),
          sets: [{ ...probe, amount: 10 }, 60],
          seconds: true,
        }),
      ],
      DEFAULT_PROGRESSION_POLICY,
      PAIRED,
    );
    expect(probeVerdict(short!, PAIRED)).toBe('failed');
  });
});

describe('a pipeline missing its rules', () => {
  const without = (...ids: string[]) => PIPELINE.filter((r) => !ids.includes(r.id));

  it('leaves an empty history alone when nothing says where to start', () => {
    const { draft } = prescribeNext(inputOf([]), without('first_exposure'));
    expect(draft).toMatchObject({ resistance: null, sets: 0, targets: [], codes: [] });
  });

  it('a deload with no history to repeat is the first-exposure rule’s to settle', () => {
    const { draft } = prescribeNext(inputOf([], { phase: 'deload' }));
    expect(draft.codes).toEqual(['FIRST_COMPARABLE_EXPOSURE', 'DELOAD']);
  });

  it('without the sets rule the exposure has no sets, and with nothing else, targets at the bottom', () => {
    const { draft } = prescribeNext(inputOf(H(...TOP4)), without('sets'));
    expect(draft.sets).toBe(0);
    const bare = prescribeNext(inputOf([]), [{ ...setsRule }, { ...normalizeRule }]).draft;
    expect(bare).toMatchObject({ resistance: null, sets: 0 });
  });

  it('fills the targets that no rule set with the bottom of the range, and extends a short list', () => {
    const rule = {
      id: 'resistance',
      apply: (_: unknown, d: Parameters<typeof normalizeRule.apply>[1]) => ({
        ...d,
        resistance: kg(4),
        decision: 'start',
        codes: ['FIRST_COMPARABLE_EXPOSURE' as const],
      }),
    };
    expect(prescribeNext(inputOf([]), [rule, setsRule, normalizeRule]).draft.targets).toEqual([
      8, 8,
    ]);
    const partial = {
      id: 'partial',
      apply: (_: unknown, d: Parameters<typeof normalizeRule.apply>[1]) => ({
        ...d,
        targets: [10],
      }),
    };
    expect(
      prescribeNext(inputOf([]), [rule, partial, setsRule, normalizeRule]).draft.targets,
    ).toEqual([10, 10]);
  });
});
