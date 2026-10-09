/**
 * Engine v2, P3 (03 §1-§3, 13 §4, T22-T28, T31, T97): what an exposure is
 * evidence of, before anyone decides what to prescribe.
 */
import { setObservationSchema } from '../observations/types';
import {
  amountOf,
  isFailure,
  isPerformed,
  qualifyExposure,
  rangeOf,
  referenceResistance,
  requiredSets,
} from '../observations/qualify';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';
import { PAIRED, body, BODY, day, exposureOf, kg, type SetResult } from './progressionFixtures';

const policy = DEFAULT_PROGRESSION_POLICY;
const at = (
  sets: (SetResult | number | null)[],
  extra: Partial<Parameters<typeof exposureOf>[0]> = {},
) => exposureOf({ date: day(0), spec: kg(4), sets, ...extra });
const qualify = (...args: Parameters<typeof at>) => qualifyExposure(at(...args), policy, PAIRED);

describe('the fixtures', () => {
  it('make results the schema accepts', () => {
    for (const set of at([12, { amount: 11, rir: null, confirmation: 'none' }]).sets) {
      expect(setObservationSchema.safeParse(set.observation).success).toBe(true);
    }
    expect(
      setObservationSchema.safeParse(
        at([{ amount: 12, confirmation: 'edited' }]).sets[0]!.observation,
      ).success,
    ).toBe(true);
  });
});

describe('T22 a complete exposure is judged against its range', () => {
  it('every set at the top with the effort asked: top_met', () => {
    const ev = qualify([12, 12, 12]);
    expect(ev).toMatchObject({
      coverage: 'complete',
      comparability: 'exact',
      quality: 'sufficient',
      context: 'normal',
      performance: 'top_met',
      effortMet: true,
      reasons: [],
    });
    expect(ev.requiredSetIds).toHaveLength(3);
    expect(ev.observedSetIds).toEqual(ev.requiredSetIds);
  });

  it('inside the range: within_range; under its bottom: below_range', () => {
    expect(qualify([12, 10, 9]).performance).toBe('within_range');
    expect(qualify([12, 10, 7]).performance).toBe('below_range');
  });

  it('a time is read the same way', () => {
    const ev = qualify([60, 60], { seconds: true });
    expect(ev.performance).toBe('top_met');
    expect(qualify([60, 15], { seconds: true }).performance).toBe('below_range');
  });
});

describe('T97 the first set must reach the top, the others may fall short of it by one', () => {
  it('12/11/11 at a top of 12 is top_met', () => {
    expect(qualify([12, 11, 11]).performance).toBe('top_met');
  });

  it('12/10/12 and 11/12/12 are not', () => {
    expect(qualify([12, 10, 12]).performance).toBe('within_range');
    expect(qualify([11, 12, 12]).performance).toBe('within_range');
  });

  it('the allowance is the policy’s', () => {
    const strict = { ...policy, dropOffAllowance: 0 };
    expect(qualifyExposure(at([12, 11, 11]), strict, PAIRED).performance).toBe('within_range');
  });

  it('the first logical set of a two-sided exercise is both its sides', () => {
    const ev = qualify([12, 11], { sides: true });
    expect(ev.performance).toBe('top_met');
    expect(qualify([{ amount: 12 }, { amount: 11 }], { sides: true }).requiredSetIds).toHaveLength(
      4,
    );
  });
});

describe('T23 an effort nobody gave is no evidence of effort', () => {
  it('no RIR at all: missing_rir, nothing to judge, and the reason says so', () => {
    const ev = qualify([12, { amount: 12, rir: null }, 12]);
    expect(ev).toMatchObject({
      quality: 'missing_rir',
      performance: 'not_evaluable',
      effortMet: null,
    });
    expect(ev.reasons).toContain('MISSING_EFFORT_EVIDENCE');
  });

  it('a suggestion saved without being shown counts as none; one the person said does not', () => {
    expect(qualify([{ amount: 12, confirmation: 'none' }]).quality).toBe('missing_rir');
    expect(qualify([{ amount: 12, confirmation: 'edited' }]).quality).toBe('sufficient');
    expect(qualify([{ amount: 12, confirmation: 'read_back' }]).quality).toBe('sufficient');
    expect(qualify([{ amount: 12, confirmation: 'visible' }]).quality).toBe('sufficient');
  });
});

describe('T24 at the top, but too hard', () => {
  it('the range is met and the effort is not: effortMet false', () => {
    const ev = qualify([12, { amount: 12, rir: 0 }, 12]);
    expect(ev.performance).toBe('top_met');
    expect(ev.effortMet).toBe(false);
  });

  it('a plan that asks for no effort asks for none', () => {
    expect(qualify([12, 12], { targetRir: null }).effortMet).toBe(true);
  });
});

describe('T25, T26 only the sets the plan required are evidence', () => {
  it('a back-off set and a warm-up do not stand in for a working set', () => {
    const rec = at([
      { amount: 12, planned: { requiredForProgression: false, role: 'backoff' } },
      { amount: 12, planned: { requiredForProgression: false, role: 'warmup' } },
      { amount: null },
    ]);
    const ev = qualifyExposure(rec, policy, PAIRED);
    expect(ev.coverage).toBe('none');
    expect(ev.performance).toBe('not_evaluable');
    expect(ev.reasons).toContain('INCOMPLETE_PLANNED_SETS');
  });

  it('an exposure with no required set is no evidence', () => {
    const rec = at([{ amount: 12, planned: { requiredForProgression: false, role: 'practice' } }]);
    expect(qualifyExposure(rec, policy, PAIRED).coverage).toBe('none');
    expect(requiredSets(rec)).toEqual([]);
  });
});

describe('T27 a different resistance is a deviation', () => {
  it('prescribed 6 kg, done at 4 kg: changed, and nothing is judged', () => {
    const ev = qualifyExposure(
      exposureOf({
        date: day(0),
        spec: kg(6),
        sets: [
          { amount: 12, spec: kg(4) },
          { amount: 12, spec: kg(4) },
        ],
      }),
      policy,
      PAIRED,
    );
    expect(ev).toMatchObject({ comparability: 'changed', performance: 'not_evaluable' });
    expect(ev.reasons).toContain('PRESCRIPTION_DEVIATION');
  });

  it('another setup of the same number is changed too', () => {
    const other = { ...kg(4), configurationKey: 'other' };
    const ev = qualifyExposure(
      exposureOf({ date: day(0), spec: kg(4), sets: [{ amount: 12, spec: other }] }),
      policy,
      PAIRED,
    );
    expect(ev.comparability).toBe('changed');
  });

  it('a resistance nobody recorded is unknown, not changed', () => {
    const rec = at([12, 12]);
    rec.sets[0]!.observation!.resistance = {
      ...rec.sets[0]!.observation!.resistance,
      value: null,
    };
    const ev = qualifyExposure(rec, policy, PAIRED);
    expect(ev.comparability).toBe('unknown');
    expect(ev.reasons).toContain('UNCONFIRMED_ACTUAL');
  });
});

describe('T28 more work than planned does not make up for a missing set', () => {
  it('a stronger extra set leaves the coverage as it was', () => {
    const base = at([12, null, 12]);
    const extra = at([12]).sets[0]!.observation!;
    const rec = { ...base, extra: [{ ...extra, plannedSetId: null, logicalSetId: null }] };
    const ev = qualifyExposure(rec, policy, PAIRED);
    expect(ev.coverage).toBe('partial');
    expect(ev.performance).toBe('not_evaluable');
  });

  it('an interrupted set is not a performed one', () => {
    const ev = qualify([12, { amount: 0, status: 'interrupted' }]);
    expect(ev.coverage).toBe('partial');
    expect(ev.observedSetIds).toHaveLength(1);
  });
});

describe('T10, T11 the sides of a set are sets', () => {
  it('a missing right side: partial coverage and the side named', () => {
    const rec = at([12, 12], { sides: true });
    rec.sets[3] = { ...rec.sets[3]!, disposition: 'skipped', observation: null };
    const ev = qualifyExposure(rec, policy, PAIRED);
    expect(ev.coverage).toBe('partial');
    expect(ev.reasons).toEqual(expect.arrayContaining(['INCOMPLETE_PLANNED_SETS', 'MISSING_SIDE']));
  });

  it('a missing both-sided set is not a missing side', () => {
    expect(qualify([12, null]).reasons).not.toContain('MISSING_SIDE');
  });
});

describe('T31 what the person said fell short is kept', () => {
  it('pain is a reason of its own and not lost', () => {
    const ev = qualify([12, { amount: 8, shortfall: 'pain' }]);
    expect(ev.shortfalls).toEqual(['pain']);
    expect(ev.reasons).toContain('PAIN_REPORTED');
    expect(isFailure(ev)).toBe(false);
  });

  it('short rest and soreness confound the exposure', () => {
    for (const shortfall of ['short_rest', 'doms'] as const) {
      const ev = qualify([12, { amount: 6, shortfall }]);
      expect(ev.reasons).toContain('CONTEXT_CONFOUNDED');
      expect(isFailure(ev)).toBe(false);
    }
  });

  it('technique is reported, and is not a confounder', () => {
    const ev = qualify([12, { amount: 6, shortfall: 'technique' }]);
    expect(ev.shortfalls).toEqual(['technique']);
    expect(ev.reasons).toEqual([]);
    expect(isFailure(ev)).toBe(true);
  });

  it('a set left out because it hurt counts as pain too (ENG-07)', () => {
    const rec = at([12, null]);
    const skipped = {
      ...rec,
      sets: rec.sets.map((s, i) =>
        i === 1 ? { ...s, disposition: 'skipped' as const, skippedForPain: true as const } : s,
      ),
    };
    const ev = qualifyExposure(skipped, policy, PAIRED);
    expect(ev.shortfalls).toEqual(['pain']);
    expect(ev.reasons).toContain('PAIN_REPORTED');
  });

  it('pain on a set outside the plan counts too', () => {
    const extra = at([12]).sets[0]!.observation!;
    const rec = {
      ...at([12, 12]),
      extra: [{ ...extra, plannedSetId: null, logicalSetId: null, shortfall: 'pain' as const }],
    };
    expect(qualifyExposure(rec, policy, PAIRED).reasons).toContain('PAIN_REPORTED');
  });
});

describe('the context of an exposure', () => {
  it('abandoned, deload and the context the history told it', () => {
    expect(
      qualifyExposure(at([12], { context: { abandoned: true } }), policy, PAIRED).context,
    ).toBe('abandoned');
    expect(qualifyExposure(at([12], { context: { deload: true } }), policy, PAIRED).context).toBe(
      'deload',
    );
    expect(qualifyExposure(at([12]), policy, PAIRED, { context: 'intro' }).context).toBe('intro');
    expect(qualifyExposure(at([12]), policy, PAIRED, { context: 'recalibration' }).context).toBe(
      'recalibration',
    );
  });

  it('an exposure of a deload week is not judged', () => {
    const ev = qualifyExposure(at([12, 12], { context: { deload: true } }), policy, PAIRED);
    expect(ev.performance).toBe('not_evaluable');
    expect(ev.coverage).toBe('complete');
  });

  it('an exposure the person shortened is not judged and says so (T71)', () => {
    const ev = qualifyExposure(at([12, 12], { context: { userReduced: true } }), policy, PAIRED);
    expect(ev.performance).toBe('not_evaluable');
    expect(ev.reasons).toContain('USER_REDUCED');
  });

  it('a complete exposure of an abandoned session is still evidence', () => {
    const ev = qualifyExposure(at([12, 12], { context: { abandoned: true } }), policy, PAIRED);
    expect(ev.performance).toBe('top_met');
    expect(ev.context).toBe('abandoned');
  });
});

describe('what a result can be read as', () => {
  it('a unit that is not the plan’s is invalid', () => {
    const rec = at([12, 12]);
    rec.sets[0]!.observation!.amount = {
      ...rec.sets[0]!.observation!.amount,
      value: { kind: 'duration', seconds: 30 },
    };
    const ev = qualifyExposure(rec, policy, PAIRED);
    expect(ev.quality).toBe('invalid');
    expect(ev.reasons).toContain('UNCONFIRMED_ACTUAL');
  });

  it('an amount of unknown origin is unconfirmed', () => {
    const rec = at([12, 12]);
    const amount = rec.sets[0]!.observation!.amount;
    rec.sets[0]!.observation!.amount = {
      ...amount,
      origin: 'legacy_unknown',
      channel: 'legacy',
      presentedDefault: false,
      confirmation: 'none',
    };
    expect(qualifyExposure(rec, policy, PAIRED).quality).toBe('unconfirmed');
  });

  it('a distance has no policy', () => {
    const rec = at([12]);
    rec.sets[0]!.planned.target = { kind: 'distance', targetMeters: 100 };
    rec.sets[0]!.observation!.amount = {
      ...rec.sets[0]!.observation!.amount,
      value: { kind: 'distance', meters: 100 },
    };
    expect(rangeOf(rec.sets[0]!.planned)).toBeNull();
    expect(qualifyExposure(rec, policy, PAIRED).quality).toBe('invalid');
    expect(amountOf(rec.sets[0]!.observation!)).toBeNull();
    expect(
      amountOf({
        ...rec.sets[0]!.observation!,
        amount: { ...rec.sets[0]!.observation!.amount, value: null },
      }),
    ).toBeNull();
  });

  it('reads reps and seconds', () => {
    expect(amountOf(at([12]).sets[0]!.observation!)).toBe(12);
    expect(amountOf(at([45], { seconds: true }).sets[0]!.observation!)).toBe(45);
    expect(rangeOf(at([12]).sets[0]!.planned)).toEqual({ lo: 8, hi: 12, target: 12 });
    expect(rangeOf(at([45], { seconds: true }).sets[0]!.planned)).toEqual({
      lo: 20,
      hi: 60,
      target: 60,
    });
    expect(isPerformed(at([12]).sets[0]!)).toBe(true);
    expect(isPerformed(at([null]).sets[0]!)).toBe(false);
  });
});

describe('T29, T30 what counts as a failure', () => {
  it('a complete exposure below the range, in an ordinary context', () => {
    expect(isFailure(qualify([7, 6]))).toBe(true);
    expect(isFailure(qualify([12, 12]))).toBe(false);
  });

  it('an incomplete one, a deload one and an abandoned one are not', () => {
    expect(isFailure(qualify([7, null]))).toBe(false);
    expect(
      isFailure(qualifyExposure(at([7, 6], { context: { deload: true } }), policy, PAIRED)),
    ).toBe(false);
    expect(
      isFailure(qualifyExposure(at([7, 6], { context: { abandoned: true } }), policy, PAIRED)),
    ).toBe(false);
  });
});

describe('the resistance the next prescription stands on', () => {
  it('is the one the sets were done at, even when it was not the planned one', () => {
    const rec = exposureOf({
      date: day(0),
      spec: kg(6),
      sets: [
        { amount: 12, spec: kg(4) },
        { amount: 12, spec: kg(4) },
      ],
    });
    expect(referenceResistance(rec, PAIRED)).toEqual(kg(4));
  });

  it('is the plan’s when nothing was done, and nothing when nothing was required', () => {
    expect(referenceResistance(at([null, null]), PAIRED)).toEqual(kg(4));
    expect(
      referenceResistance(
        at([{ amount: 12, planned: { requiredForProgression: false, role: 'practice' } }]),
        PAIRED,
      ),
    ).toBeNull();
  });

  it('is the plan’s when the resistance of the results was not recorded', () => {
    const rec = at([12]);
    rec.sets[0]!.observation!.resistance = { ...rec.sets[0]!.observation!.resistance, value: null };
    expect(referenceResistance(rec, PAIRED)).toEqual(kg(4));
  });

  it('after a calibration in the session it is the heaviest step that met the range', () => {
    const rec = exposureOf({
      date: day(0),
      spec: kg(4),
      sets: [
        { amount: 12, rir: 3 },
        { amount: 10, rir: 2, spec: kg(6), planned: { resistance: kg(6) } },
        { amount: 9, rir: 2, spec: kg(6), planned: { resistance: kg(6) } },
      ],
    });
    expect(referenceResistance(rec, PAIRED)).toEqual(kg(6));
  });

  it('is the lightest used when no step met the range with the effort asked', () => {
    const rec = exposureOf({
      date: day(0),
      spec: kg(4),
      sets: [{ amount: 6 }, { amount: 12, rir: 0, spec: kg(6), planned: { resistance: kg(6) } }],
    });
    expect(referenceResistance(rec, PAIRED)).toEqual(kg(4));
  });

  it('ignores a step that fell short of the range while a lighter one met it', () => {
    const rec = exposureOf({
      date: day(0),
      spec: kg(4),
      sets: [{ amount: 12 }, { amount: 5, spec: kg(6), planned: { resistance: kg(6) } }],
    });
    expect(referenceResistance(rec, PAIRED)).toEqual(kg(4));
  });

  it('works for a body that has one step', () => {
    const rec = exposureOf({ date: day(0), spec: body, sets: [5, 4], exerciseId: 'crunch' });
    expect(referenceResistance(rec, BODY)).toEqual(body);
    expect(qualifyExposure(rec, policy, BODY).performance).toBe('below_range');
  });
});
