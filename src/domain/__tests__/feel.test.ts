import { assessSessionChange, rankAlternatives } from '../session/assess';
import { assessFeel } from '../session/effort';
import { evaluateSessionChange } from '../session/evaluate';
import type { FeelChange, ActiveSessionState, SessionChangeSnapshot } from '../session/types';
import { sessionPlanSchema } from '../plan/plan';
import { stampPlan } from '../plan/compile';
import { recipe, world, perform } from './sessionChangeFixtures';
import { CATALOG } from './dayFixtures';
import { HASH_A } from './planFixtures';

function feel(
  snap: SessionChangeSnapshot,
  session: ActiveSessionState,
  value: FeelChange['feel'] = 'too_hard',
  id: string | null = session.plan.exposures[0]!.id,
) {
  return assessSessionChange(snap, session, { kind: 'feel', exposureId: id, feel: value });
}
const recommended = (a: ReturnType<typeof feel>) =>
  a.feel!.options.filter((o) => a.feel!.recommendedOptionIds.includes(o.id));

describe('P4b.5 T71/T72/T105: feel is an observation and each offered change is assessed', () => {
  it('T71 after one of three sets recommends a lighter step for the two pending sets', () => {
    const rx = recipe('db-floor-press', 3);
    rx.sets = rx.sets.map((s) => ({
      ...s,
      resistance: { ...s.resistance, value: { ...s.resistance.value, massGrams: 8000 } },
    }));
    const { snap, session } = world([rx]);
    session.records = perform(session, 1);
    const before = JSON.stringify({ snap, session });
    const a = feel(snap, session);
    expect(a.patch).toBeNull();
    expect(a.alternatives).toEqual([]);
    expect(a.effects.time.remainingAfterSec).toBe(a.effects.time.remainingBeforeSec);
    expect(a.feel!.options.map((o) => o.why)).toEqual([
      'drop_set',
      'easier_resistance',
      'skip_remaining',
    ]);
    const [choice] = recommended(a);
    expect(choice!.why).toBe('easier_resistance');
    const revised = choice!.assessment.patch!.plan;
    expect(revised.exposures[0]!.sets).toEqual([session.plan.exposures[0]!.sets[0]]);
    expect(revised.exposures.at(-1)!.sets).toHaveLength(2);
    expect(revised.exposures.at(-1)!.sets[0]!.resistance.value).toMatchObject({ massGrams: 6000 });
    for (const o of a.feel!.options) {
      expect(o.assessment).toEqual(evaluateSessionChange(snap, session, o.change!));
      expect(sessionPlanSchema.safeParse(o.assessment.patch!.plan).success).toBe(true);
    }
    expect(JSON.stringify({ snap, session })).toBe(before);
    expect(feel(snap, session)).toEqual(a);
  });

  it('one pending set recommends dropping it even when lighter resistance exists', () => {
    const { snap, session } = world([recipe('db-floor-press', 2)]);
    session.records = perform(session, 1);
    expect(recommended(feel(snap, session))[0]!.why).toBe('drop_set');
  });

  it('T105 bodyweight uses only easier variants, with USER_REDUCED context on the new recipe', () => {
    const { snap, session } = world([recipe('push-up', 3)]);
    session.records = perform(session, 1);
    const a = feel(snap, session);
    const variant = recommended(a)[0]!;
    expect(variant.why).toBe('variant_easier');
    expect(variant.change).toMatchObject({
      kind: 'swap_remaining',
      exercise: { id: 'incline-push-up' },
    });
    expect(variant.assessment.patch!.plan.exposures.at(-1)!.trace.evidence.reducedFrom).toBe(
      session.plan.exposures[0]!.id,
    );
    const lower = a.feel!.options.find((o) => o.why === 'easier_resistance')!;
    expect(lower.assessment.patch).toBeNull();
    expect(lower.assessment.checks).toContainEqual(
      expect.objectContaining({ code: 'RESISTANCE_UNREACHABLE', status: 'fail' }),
    );
  });

  it.each(['crunch', 'plank'] as const)(
    'T105 no lower step or variant for %s recommends minus one set',
    (id) => {
      const { snap, session } = world([recipe(id, 3)]);
      snap.catalog = Object.fromEntries(
        Object.entries(snap.catalog).map(([key, e]) => [
          key,
          {
            ...e,
            progressions: key === id ? [] : e.progressions?.filter((p) => p.to !== id),
          },
        ]),
      );
      expect(recommended(feel(snap, session))[0]!.why).toBe('drop_set');
    },
  );

  it('an excluded easier variant is never offered', () => {
    const { snap, session } = world([recipe('push-up', 2)]);
    snap.eligibility = {
      ...snap.eligibility,
      excludedIds: new Set(['incline-push-up', 'knee-push-ups']),
    };
    expect(recommended(feel(snap, session))[0]!.why).toBe('drop_set');
    expect(feel(snap, session).feel!.options.some((o) => o.why === 'variant_easier')).toBe(false);
  });

  it('a manual exposure without a slot still gets the easier variant from the catalog graph', () => {
    const { snap, session } = world([recipe('push-up', 3, { slotId: null })]);
    expect(recommended(feel(snap, session))[0]!.why).toBe('variant_easier');
  });

  it('at the lightest dumbbell step offers the eligible easier variant', () => {
    const rx = recipe('db-floor-press', 2);
    rx.sets = rx.sets.map((s) => ({
      ...s,
      resistance: { ...s.resistance, value: { ...s.resistance.value, massGrams: 2000 } },
    }));
    const { snap, session } = world([rx]);
    snap.catalog = {
      ...snap.catalog,
      'db-floor-press': {
        ...CATALOG['db-floor-press']!,
        progressions: [{ kind: 'easier', to: 'band-chest-press' }],
      },
    };
    expect(recommended(feel(snap, session))[0]!.change).toMatchObject({
      kind: 'swap_remaining',
      exercise: { id: 'band-chest-press' },
    });
  });

  it('too easy recommends one supplemental set only when its assessment is ok', () => {
    const { snap, session } = world([recipe('crunch', 2)]);
    const a = feel(snap, session, 'too_easy');
    const choice = recommended(a)[0]!;
    expect(choice.why).toBe('add_set');
    expect(choice.assessment.effects.progressionScope).toBe('supplemental');
    expect(choice.assessment.patch!.plan.exposures[0]!.sets.at(-1)!.requiredForProgression).toBe(
      false,
    );
    expect(
      choice.assessment
        .patch!.plan.exposures[0]!.sets.slice(0, 2)
        .every((s) => s.requiredForProgression),
    ).toBe(true);
    expect(a.feel!.options.at(-1)).toMatchObject({
      why: 'next_prescription',
      change: null,
      assessment: { patch: null },
    });
  });

  it('day max exceeded keeps the assessed option but recommends the next prescription flag', () => {
    const { snap, session } = world([recipe('crunch', 3)]);
    const a = feel(snap, session, 'too_easy');
    expect(a.feel!.options[0]!.assessment.verdict).toBe('not_recommended');
    expect(a.feel!.options[0]!.assessment.patch).not.toBeNull();
    expect(recommended(a)[0]!.why).toBe('next_prescription');
  });

  it('technical set limits recommend the flag without a writable extra-set option', () => {
    const { snap, session } = world([recipe('crunch', 10)]);
    const a = feel(snap, session, 'too_easy');
    expect(a.feel!.options[0]!.assessment.patch).toBeNull();
    expect(recommended(a)[0]!.why).toBe('next_prescription');
  });

  it('a completed exposure can report too easy and add work; too hard has no remaining choices', () => {
    const { snap, session } = world([recipe('crunch', 2)]);
    session.records = perform(session);
    expect(feel(snap, session).feel).toEqual({ options: [], recommendedOptionIds: [] });
    expect(feel(snap, session, 'too_easy').feel!.options[0]!.change).toMatchObject({
      kind: 'add_sets',
      sets: 1,
    });
  });

  it('a session-wide report offers choices for each pending exposure, skipping completed ones', () => {
    const { snap, session } = world([
      recipe('crunch', 2),
      recipe('db-floor-press', 2),
      recipe('standing-calf-raise', 2),
    ]);
    session.records = perform(session, 2);
    const a = feel(snap, session, 'too_hard', null);
    expect(recommended(a)).toHaveLength(2);
    expect(
      a.feel!.options.every(
        (o) =>
          o.change &&
          'exposureId' in o.change &&
          o.change.exposureId !== session.plan.exposures[0]!.id,
      ),
    ).toBe(true);
    const easy = feel(snap, session, 'too_easy', null);
    expect(easy.feel!.options.filter((o) => o.why === 'add_set')).toHaveLength(2);
    session.records = perform(session);
    expect(recommended(feel(snap, session, 'too_easy', null))[0]!.why).toBe('next_prescription');
    expect(feel(snap, session, 'too_hard', null).feel!.options).toEqual([]);
  });

  it('empty session: too easy is a flag, too hard has no fabricated changes', () => {
    const { snap, session } = world();
    expect(recommended(feel(snap, session, 'too_easy', null))[0]!.why).toBe('next_prescription');
    expect(feel(snap, session, 'too_hard', null).feel!.options).toEqual([]);
  });

  it('unilateral remainder cannot drop a completed side, so skip is the fallback', () => {
    const { snap, session } = world([recipe('side-plank', 1, { sideMode: 'per_set' })]);
    session.records = perform(session, 1);
    expect(recommended(feel(snap, session))[0]!.why).toBe('skip_remaining');
  });

  it('pain permits removing pending work but never recommends an extra set', () => {
    const { snap, session } = world([recipe('crunch', 3)]);
    session.records = perform(session, 1);
    session.records[0]!.sets[0]!.observation!.shortfall = 'pain';
    const a = feel(snap, session);
    expect(recommended(a)[0]!.why).toBe('skip_remaining');
    expect(recommended(feel(snap, session, 'too_easy'))[0]!.why).toBe('next_prescription');
  });

  it('unknown exposure and wrong training date have no offered changes', () => {
    const { snap, session } = world([recipe('crunch')]);
    expect(feel(snap, session, 'too_hard', 'unknown').feel!.options).toEqual([]);
    snap.asOf = '2026-10-06';
    expect(feel(snap, session).feel!.recommendedOptionIds).toEqual([]);
  });

  it('invalid integrity and unsupported execution stop before options are made', () => {
    const { snap, session } = world([recipe('crunch')]);
    session.plan.exposures[0]!.sets[0]!.target = { kind: 'distance', targetMeters: 5 };
    const { audit: _, ...draft } = session.plan;
    session.plan = stampPlan(draft, {
      mode: 'new_plan',
      snapshotFingerprint: HASH_A,
      overrides: [],
    });
    expect(feel(snap, session).feel!.options).toEqual([]);
    session.plan.audit.planHash = 'f'.repeat(64);
    expect(feel(snap, session).feel!.options).toEqual([]);
  });

  it('the variant direction filter excludes harder neighbours and slot-only candidates', () => {
    const { snap, session } = world();
    const result = rankAlternatives(
      { exerciseId: 'push-up', muscles: [] },
      {
        snap,
        session,
        change: { kind: 'add_exercise', exercise: { id: 'push-up' }, sets: 1 },
        variantDirection: 'harder',
      },
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((r) => r.why.includes('variant_harder'))).toBe(true);
  });

  it('a failed fallback produces no recommendation', () => {
    // Another unsafe pending exposure makes even skipping only this one blocked.
    const another = recipe('standing-calf-raise');
    const w = world([recipe('crunch'), another]);
    w.snap.catalog = {
      ...w.snap.catalog,
      'standing-calf-raise': { ...CATALOG['standing-calf-raise']!, archived: true },
    };
    expect(feel(w.snap, w.session).feel!.recommendedOptionIds).toEqual([]);
  });

  it('malformed leaf findings do not generate choices', () => {
    const { snap, session } = world();
    const change: FeelChange = { kind: 'feel', exposureId: null, feel: 'too_hard' };
    const a = evaluateSessionChange(snap, session, change);
    expect(
      assessFeel(snap, session, change, {
        ...a,
        checks: [{ code: 'PLAN_INTEGRITY', class: 'hard', status: 'fail', data: {} }],
      }).options,
    ).toEqual([]);
  });
});
