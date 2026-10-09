/**
 * Engine v2, P3 (03 §15, 13 §16, T88-T92): the probe set, and what it showed.
 */
import { assess } from '../progression/assessed';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';
import {
  isProbe,
  probeCooldown,
  probeVerdict,
  relativeStepOf,
  rirBias,
  shouldProbe,
} from '../progression/probe';
import { RESISTANCE_REGISTRY } from '../resistance/registry';
import {
  BODY,
  PAIRED,
  body,
  day,
  exposureOf,
  kg,
  type ExposureOptions,
  type SetResult,
} from './progressionFixtures';

const policy = DEFAULT_PROGRESSION_POLICY;
const probe = (patch: Partial<SetResult> = {}, spec = kg(6)): SetResult => ({
  amount: 10,
  spec,
  planned: { role: 'probe', requiredForProgression: false, resistance: spec },
  ...patch,
});
const assessed = (...records: ReturnType<typeof exposureOf>[]) => assess(records, policy, PAIRED);
const withProbe = (set: SetResult, date = 0) =>
  assessed(exposureOf({ date: day(date), spec: kg(4), sets: [set, 12, 12] }))[0]!;

describe('T91 the size of a step', () => {
  it('is what the model says', () => {
    expect(relativeStepOf(PAIRED, kg(4), kg(6))).toBe(0.5);
    expect(relativeStepOf(PAIRED, kg(8), kg(10))).toBe(0.25);
    expect(relativeStepOf(BODY, body, body)).toBeNull();
  });

  it('is not known for a band nobody measured', () => {
    const made = RESISTANCE_REGISTRY.create({ id: 'band.long', parameters: { romCm: 40 } });
    if (!made.ok) throw new Error('band model');
    const [first, second] = made.model.levels();
    expect(
      relativeStepOf(
        made.model,
        { ...kg(4), modelId: 'band.long', value: first!.value },
        { ...kg(4), modelId: 'band.long', value: second!.value },
      ),
    ).toBeNull();
  });

  it('a big step, or an unknown one, is tried with a probe; a small one is taken', () => {
    expect(shouldProbe(0.5, policy)).toBe(true);
    expect(shouldProbe(0.15, policy)).toBe(true);
    expect(shouldProbe(0.14, policy)).toBe(false);
    expect(shouldProbe(null, policy)).toBe(true);
  });
});

describe('T89, T90 what a probe showed', () => {
  it('passed: the bottom of the range, with the effort asked', () => {
    expect(probeVerdict(withProbe(probe()), PAIRED)).toBe('passed');
    expect(probeVerdict(withProbe(probe({ amount: 8 })), PAIRED)).toBe('passed');
  });

  it('failed: under the bottom of the range, or to the limit', () => {
    expect(probeVerdict(withProbe(probe({ amount: 7 })), PAIRED)).toBe('failed');
    expect(probeVerdict(withProbe(probe({ rir: 0 })), PAIRED)).toBe('failed');
  });

  it('nothing when it was not asked for effort at all', () => {
    const set = probe({
      planned: { role: 'probe', requiredForProgression: false, resistance: kg(6), targetRir: null },
    });
    expect(probeVerdict(withProbe(set), PAIRED)).toBe('passed');
  });

  it('nothing when it is not known how hard it was, or at what', () => {
    expect(probeVerdict(withProbe(probe({ rir: null })), PAIRED)).toBeNull();
    expect(probeVerdict(withProbe(probe({ spec: kg(4) })), PAIRED)).toBeNull();
    const unknown = withProbe(probe());
    const set = unknown.rec.sets.find(isProbe)!;
    set.observation!.resistance = { ...set.observation!.resistance, value: null };
    expect(probeVerdict(unknown, PAIRED)).toBeNull();
  });

  it('nothing when there was no probe, or it was not done', () => {
    expect(
      probeVerdict(assessed(exposureOf({ date: day(0), spec: kg(4), sets: [12, 12] }))[0]!, PAIRED),
    ).toBeNull();
    expect(probeVerdict(withProbe(probe({ amount: null })), PAIRED)).toBeNull();
  });

  it('nothing for a measure no policy reads', () => {
    const a = withProbe(probe());
    const set = a.rec.sets.find(isProbe)!;
    set.planned.target = { kind: 'distance', targetMeters: 10 };
    expect(probeVerdict(a, PAIRED)).toBeNull();
  });
});

describe('T90 a failed probe is not tried again at once', () => {
  const passed = (date: number, sets: ExposureOptions['sets'] = [12, 12]) =>
    exposureOf({ date: day(date), spec: kg(4), sets });
  const failed = (date: number) =>
    exposureOf({ date: day(date), spec: kg(4), sets: [probe({ amount: 4 }), 12, 12] });

  it('two exposures at the top are needed after it', () => {
    expect(probeCooldown(assessed(failed(0)), PAIRED, policy)).toBe(2);
    expect(probeCooldown(assessed(failed(0), passed(2)), PAIRED, policy)).toBe(1);
    expect(probeCooldown(assessed(failed(0), passed(2), passed(4)), PAIRED, policy)).toBe(0);
  });

  it('an exposure that was not at the top does not count', () => {
    expect(probeCooldown(assessed(failed(0), passed(2, [10, 9])), PAIRED, policy)).toBe(2);
  });

  it('an exposure with nothing done does not count, and does not end it', () => {
    expect(probeCooldown(assessed(failed(0), passed(2, [null, null])), PAIRED, policy)).toBe(2);
  });

  it('there is none when no probe failed, or when it passed', () => {
    expect(probeCooldown(assessed(passed(0), passed(2)), PAIRED, policy)).toBe(0);
    expect(
      probeCooldown(
        assessed(exposureOf({ date: day(0), spec: kg(4), sets: [probe(), 12, 12] })),
        PAIRED,
        policy,
      ),
    ).toBe(0);
    expect(probeCooldown([], PAIRED, policy)).toBe(0);
  });

  it('only the latest failed probe counts', () => {
    expect(
      probeCooldown(assessed(failed(0), passed(2), passed(4), failed(6)), PAIRED, policy),
    ).toBe(2);
  });
});

describe('T92 a probe is work and is not required', () => {
  it('is not a set the exposure needs to be complete', () => {
    const a = withProbe(probe());
    expect(a.ev.coverage).toBe('complete');
    expect(a.ev.requiredSetIds).toHaveLength(2);
    const notDone = withProbe(probe({ amount: null }));
    expect(notDone.ev.coverage).toBe('complete');
    expect(notDone.ev.performance).toBe('top_met');
  });
});

describe('D33 the person’s reporting bias', () => {
  const hard = (date: number, reps: number, extra: Partial<ExposureOptions> = {}) =>
    exposureOf({
      date: day(date),
      spec: kg(4),
      sets: [
        { amount: reps, rir: 0 },
        { amount: reps, rir: 0 },
      ],
      ...extra,
    });

  it('is what came later beyond what was reported, once there are enough pairs', () => {
    const bias = rirBias(
      assessed(hard(0, 10), hard(2, 12), hard(4, 14), hard(6, 16)),
      PAIRED,
      policy,
    );
    expect(bias).toEqual({ pairs: 6, median: 2 });
  });

  it('is the middle of an even number', () => {
    const records = [hard(0, 10), hard(2, 12), hard(4, 14), hard(6, 15), hard(8, 16)];
    expect(rirBias(assessed(...records), PAIRED, policy)).toMatchObject({ pairs: 8, median: 1.5 });
  });

  it('is nothing with too few pairs', () => {
    expect(rirBias(assessed(hard(0, 10), hard(2, 12)), PAIRED, policy)).toBeNull();
  });

  it('reads only sets reported as hard, at one resistance, with an effort given', () => {
    const easy = (date: number) => exposureOf({ date: day(date), spec: kg(4), sets: [12, 12] });
    expect(
      rirBias(assessed(easy(0), easy(2), easy(4), easy(6), easy(8), easy(10)), PAIRED, policy),
    ).toBeNull();
    const heavier = exposureOf({
      date: day(2),
      spec: kg(6),
      sets: [
        { amount: 12, rir: 0 },
        { amount: 12, rir: 0 },
      ],
    });
    const records = [
      hard(0, 10),
      heavier,
      hard(4, 10),
      heavier,
      hard(8, 10),
      heavier,
      hard(12, 10),
    ];
    expect(rirBias(assessed(...records), PAIRED, policy)).toBeNull();
    const silent = exposureOf({
      date: day(2),
      spec: kg(4),
      sets: [
        { amount: 12, rir: null },
        { amount: 12, rir: null },
      ],
    });
    expect(
      rirBias(assessed(hard(0, 10), silent, silent, silent, silent, silent), PAIRED, policy),
    ).toBeNull();
  });

  it('does not pair a set with one that was not done', () => {
    const half = exposureOf({ date: day(2), spec: kg(4), sets: [{ amount: 12, rir: 0 }, null] });
    expect(rirBias(assessed(hard(0, 10), half, half, half, half), PAIRED, policy)).toBeNull();
  });
});
