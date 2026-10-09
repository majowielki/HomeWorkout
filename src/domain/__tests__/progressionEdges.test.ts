/**
 * Engine v2, P3: the corners of the progression modules that the main suites
 * do not walk — ranking the groups of a calibrated exposure, the median of an
 * odd number, results in a measure no policy reads, exposures of one day.
 */
import { assess } from '../progression/assessed';
import { buildUpTargets } from '../progression/buildUp';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';
import { prescribeNext } from '../progression/next';
import { rirBias } from '../progression/probe';
import { qualifyExposure, referenceResistance } from '../observations/qualify';
import { PAIRED, body, day, exposureOf, kg, type SetResult } from './progressionFixtures';

const policy = DEFAULT_PROGRESSION_POLICY;

describe('how the groups of a calibrated exposure are ranked', () => {
  const set = (mass: number, patch: Partial<SetResult> = {}): SetResult => ({
    amount: 12,
    spec: kg(mass),
    planned: { resistance: kg(mass) },
    ...patch,
  });
  const reference = (...sets: SetResult[]) =>
    referenceResistance(exposureOf({ date: day(0), spec: kg(4), sets }), PAIRED);

  it('the heaviest step that met the range, whatever the order of the sets', () => {
    expect(reference(set(2), set(4), set(6, { amount: 5 }))).toEqual(kg(4));
    expect(reference(set(6, { amount: 5 }), set(4), set(2))).toEqual(kg(4));
    expect(reference(set(4), set(2))).toEqual(kg(4));
    expect(reference(set(2), set(4))).toEqual(kg(4));
  });

  it('the lightest step used when none met it', () => {
    expect(reference(set(6, { amount: 5 }), set(4, { amount: 5 }), set(2, { amount: 5 }))).toEqual(
      kg(2),
    );
    expect(reference(set(2, { amount: 5 }), set(4, { amount: 5 }))).toEqual(kg(2));
  });

  it('a step whose effort nobody gave has not shown it met the range', () => {
    expect(reference(set(4), set(6, { rir: null }))).toEqual(kg(4));
  });

  it('a step the plan asked no effort of is judged by the range alone', () => {
    const none = { resistance: kg(6), targetRir: null };
    expect(reference(set(4), set(6, { planned: none }))).toEqual(kg(6));
  });

  it('setups that cannot be compared are neither heavier nor lighter', () => {
    const other = { ...kg(6), configurationKey: 'other' };
    const picked = reference(set(4), { amount: 12, spec: other, planned: { resistance: other } });
    expect([kg(4), other]).toContainEqual(picked);
  });
});

describe('the reasons are said once', () => {
  it('a resistance nobody recorded and an amount of unknown origin are one thing to confirm', () => {
    const rec = exposureOf({ date: day(0), spec: kg(4), sets: [12, 12] });
    for (const s of rec.sets) {
      s.observation!.resistance = { ...s.observation!.resistance, value: null };
      s.observation!.amount = {
        ...s.observation!.amount,
        origin: 'legacy_unknown',
        channel: 'legacy',
        presentedDefault: false,
        confirmation: 'none',
      };
    }
    const ev = qualifyExposure(rec, policy, PAIRED);
    expect(ev.reasons).toEqual(['UNCONFIRMED_ACTUAL']);
    expect(ev.comparability).toBe('unknown');
    expect(ev.quality).toBe('unconfirmed');
  });

  it('a resistance that changed stays changed when another set’s is unknown', () => {
    const rec = exposureOf({
      date: day(0),
      spec: kg(6),
      sets: [{ amount: 12, spec: kg(4) }, { amount: 12 }],
    });
    rec.sets[1]!.observation!.resistance = { ...rec.sets[1]!.observation!.resistance, value: null };
    expect(qualifyExposure(rec, policy, PAIRED).comparability).toBe('changed');
  });
});

describe('a result in a measure no policy reads', () => {
  it('is no target', () => {
    const rec = exposureOf({ date: day(0), spec: body, sets: [5] });
    rec.sets[0]!.observation!.amount.value = { kind: 'distance', meters: 5 };
    expect(buildUpTargets(rec, { lo: 8 }, 1, 2, 1)).toEqual([]);
  });
});

describe('D33 an odd number of pairs', () => {
  it('has a middle one', () => {
    const once = (date: number, reps: number) =>
      exposureOf({ date: day(date), spec: kg(4), sets: [{ amount: reps, rir: 0 }] });
    const records = [once(0, 10), once(2, 12), once(4, 15), once(6, 16), once(8, 17), once(10, 20)];
    expect(rirBias(assess(records, policy, PAIRED), PAIRED, policy)).toEqual({
      pairs: 5,
      median: 2,
    });
  });
});

describe('exposures on one day', () => {
  it('are told apart by their id, so that the order they came in does not matter', () => {
    const input = (history: ReturnType<typeof exposureOf>[]) => ({
      exerciseId: 'ex',
      unit: 'reps' as const,
      model: PAIRED,
      start: kg(4),
      range: { lo: 8, hi: 12 },
      targetRir: { min: 2, max: 3 },
      repCap: 25,
      history,
      asOf: day(4),
      layoff: { tier: 'none' as const, gapDays: 2, recalibrating: false },
      phase: 'work' as const,
      eligible: true,
      sets: {
        recommended: 2,
        allowed: [1, 3] as [number, number],
        advisable: [1, 10] as [number, number],
        reasons: [],
      },
    });
    const a = exposureOf({
      date: day(2),
      spec: kg(4),
      sets: [10, 9],
      context: { feel: 'too_easy' },
    });
    const b = {
      ...exposureOf({ date: day(2), spec: kg(4), sets: [10, 9] }),
      exposureId: 'zz/r1/e1',
    };
    const earlier = [exposureOf({ date: day(0), spec: kg(4), sets: [10, 9] })];
    const forward = prescribeNext(input([...earlier, a, b]));
    const backward = prescribeNext(input([b, a, ...earlier]));
    expect(forward.draft).toEqual(backward.draft);
  });
});
