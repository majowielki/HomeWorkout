import { assessSessionChange, rankAlternatives } from '../session/assess';
import type { AssessmentContext, AlternativesTarget } from '../session/types';
import type { Exercise } from '../types';
import { biomechSimilarity, substituteScore } from '../exercises/substitute';
import { sessionPlanSchema } from '../plan/plan';
import { CATALOG, SLOTS } from './dayFixtures';
import { world, recipe, perform } from './sessionChangeFixtures';
import { exposureOf, body } from './progressionFixtures';
import { exerciseSchema } from '@data/exercises.schema';

const exercise = (id: string, patch: Partial<Exercise> = {}): Exercise => ({
  ...CATALOG.crunch!,
  id,
  name: id,
  aliases: [],
  substituteIds: [],
  progressions: [],
  comparisonFamily: null,
  ...patch,
});

function pool(candidates: Exercise[], source = exercise('source')) {
  const { snap, session } = world();
  snap.catalog = { ...CATALOG, source, ...Object.fromEntries(candidates.map((e) => [e.id, e])) };
  snap.slots = [
    ...SLOTS,
    {
      ...SLOTS.find((s) => s.id === 'core-front')!,
      id: 'test',
      exerciseIds: ['source', ...candidates.map((e) => e.id)],
    },
  ];
  const target: AlternativesTarget = { exerciseId: 'source', muscles: source.primaryMuscles };
  const ctx: AssessmentContext = {
    snap,
    session,
    change: { kind: 'add_exercise', exercise: { id: 'source' }, sets: 1 },
  };
  return { snap, session, target, ctx };
}

const ids = (result: ReturnType<typeof rankAlternatives>) => result.map((r) => r.exerciseId);

describe('P4b.3 T67: complete, stable lexicographic ranking', () => {
  it('evaluates every returned intent with the same leaf, each with its own prescription and patch', () => {
    const { snap, session, target, ctx } = pool(['a', 'b', 'c', 'd'].map((id) => exercise(id)));
    const before = JSON.stringify({ snap, session });
    const ranked = rankAlternatives(target, ctx);
    expect(ids(ranked)).toEqual(['a', 'b', 'c']);
    expect(new Set(ranked.map((r) => r.patchId)).size).toBe(3);
    for (const r of ranked) {
      const { alternatives, ...leaf } = assessSessionChange(snap, session, r.change, {
        maxAlternatives: 0,
      });
      expect(alternatives).toEqual([]);
      expect(r.assessment).toEqual(leaf);
      expect(r.verdict).toBe(leaf.verdict);
      expect(r.prescription).toEqual(leaf.prescription);
      expect(r.patchId).toBe(leaf.patch!.patchId);
      expect(sessionPlanSchema.safeParse(leaf.patch!.plan).success).toBe(true);
      expect(leaf).not.toHaveProperty('alternatives');
    }
    expect(JSON.stringify({ snap, session })).toBe(before);
  });

  it('T67 verdict wins over stronger biomechanics and a heart', () => {
    const { snap, ctx, target } = pool([
      exercise('strong', { stanceMechanics: 'Bilateral', isClosedKineticChain: true }),
      exercise('safe', { primaryMuscles: ['calves'], movementPattern: 'Isolation' }),
    ]);
    snap.records = [
      exposureOf({
        date: snap.asOf,
        exerciseId: 'crunch',
        spec: body,
        sets: [{ amount: 10 }, { amount: 10 }, { amount: 10 }],
      }),
    ];
    snap.preferences.exercises.strong = 'prefer';
    const ranked = rankAlternatives(target, ctx);
    expect(ids(ranked)).toEqual(['safe', 'strong']);
    expect(ranked[0]!.verdict).toBe('ok');
    expect(ranked[1]!.verdict).toBe('not_recommended');
    expect(ranked[1]!.patchId).toBeTruthy();
  });

  it('biomechanics wins over preference and is normalized with the existing score', () => {
    const { snap, ctx, target } = pool([
      exercise('liked'),
      exercise('close', { stanceMechanics: 'Bilateral', isClosedKineticChain: true }),
    ]);
    snap.preferences.exercises.liked = 'prefer';
    expect(ids(rankAlternatives(target, ctx))).toEqual(['close', 'liked']);
    expect(biomechSimilarity(snap.catalog.source!, snap.catalog.close!)).toBe(
      substituteScore(snap.catalog.source!, snap.catalog.close!) / 115,
    );
  });

  it('T67 preference resolves equal biomechanics; an exercise heart wins over avoided equipment', () => {
    const { snap, ctx, target } = pool([
      exercise('neutral'),
      exercise('band', { equipment: ['band'] }),
      exercise('heart', { equipment: ['dumbbell'], dumbbellMode: 'paired' }),
    ]);
    snap.preferences.equipment = { band: 'prefer', dumbbell: 'avoid' };
    snap.preferences.exercises.heart = 'prefer';
    const ranked = rankAlternatives(target, ctx);
    expect(ids(ranked)).toEqual(['heart', 'band', 'neutral']);
    expect(ranked[0]!.why).toContain('preference');
    expect(ranked[2]!.why).not.toContain('preference');
  });

  it('T75 avoids lower the rank without emptying the pool', () => {
    const { snap, ctx, target } = pool([exercise('own-avoid'), exercise('equipment-avoid')]);
    snap.preferences.exercises['own-avoid'] = 'avoid';
    snap.preferences.equipment.bodyweight = 'avoid';
    expect(ids(rankAlternatives(target, ctx))).toEqual(['equipment-avoid', 'own-avoid']);
  });

  it('credits only the weekly deficit covered before slot order', () => {
    const { ctx, target } = pool([
      exercise('partial', { primaryMuscles: ['core'] }),
      exercise('full', { primaryMuscles: ['core', 'calves'] }),
    ]);
    const result = rankAlternatives(target, ctx);
    expect(ids(result)).toEqual(['full', 'partial']);
    expect(result[0]!.why).toContain('week_min_helped');
    ctx.snap.records = [
      exposureOf({
        date: '2026-10-01',
        exerciseId: 'crunch',
        spec: body,
        sets: [{ amount: 10 }, { amount: 10 }, { amount: 10 }],
      }),
    ];
    const next = rankAlternatives(target, ctx);
    expect(next.find((r) => r.exerciseId === 'partial')!.why).not.toContain('week_min_helped');
  });

  it('uses overlap after equal verdict, biomechanics, preference and weekly credit', () => {
    const { ctx, target } = pool(
      [
        exercise('overlap', { movementPattern: 'Core', primaryMuscles: ['calves'] }),
        exercise('apart', { movementPattern: 'Isolation', primaryMuscles: ['calves'] }),
      ],
      exercise('source', { movementPattern: 'Push', primaryMuscles: ['calves'] }),
    );
    ctx.snap.catalog = {
      ...ctx.snap.catalog,
      crunch: { ...CATALOG.crunch!, movementPattern: 'Core', primaryMuscles: ['back'] },
    };
    ctx.snap.records = [
      exposureOf({ date: ctx.snap.asOf, exerciseId: 'crunch', spec: body, sets: [{ amount: 10 }] }),
    ];
    // A shared global advice failure puts both candidates in the same verdict bucket.
    ctx.change = { ...ctx.change, kind: 'add_exercise', sets: 7 };
    expect(ids(rankAlternatives(target, ctx))).toEqual(['apart', 'overlap']);
  });

  it('uses recovery after equal earlier keys', () => {
    const { ctx, target } = pool(
      [
        exercise('recovering', { primaryMuscles: ['core'] }),
        exercise('fresh', { primaryMuscles: ['calves'] }),
      ],
      exercise('source', { primaryMuscles: ['core', 'calves'] }),
    );
    ctx.snap.daily = [
      { date: ctx.snap.asOf, sleepHours: null, energy: null, soreness: { core: 4 } },
    ];
    ctx.change = { kind: 'add_exercise', exercise: { id: 'source' }, sets: 7 };
    expect(ids(rankAlternatives(target, ctx))).toEqual(['fresh', 'recovering']);
  });

  it('keeps authored slot order and breaks a full tie by code points, independent of catalogue/slot/edge/substitute order', () => {
    const { snap, ctx, target } = pool(
      [exercise('z'), exercise('a')],
      exercise('source', {
        substituteIds: ['a', 'z'],
        progressions: [
          { kind: 'harder', to: 'z' },
          { kind: 'harder', to: 'a' },
        ],
      }),
    );
    expect(ids(rankAlternatives(target, ctx))).toEqual(['z', 'a']);
    const testSlot = snap.slots.at(-1)!;
    snap.slots = [
      ...SLOTS,
      { ...testSlot, exerciseIds: ['source'] },
      ...['z', 'a'].map((id) => ({ ...testSlot, id, exerciseIds: [id] })),
    ];
    const result = rankAlternatives(target, ctx);
    expect(ids(result)).toEqual(['a', 'z']);
    snap.catalog = Object.fromEntries(Object.entries(snap.catalog).reverse());
    snap.slots = [...snap.slots].reverse();
    snap.catalog = {
      ...snap.catalog,
      source: {
        ...snap.catalog.source!,
        substituteIds: ['z', 'a'],
        progressions: [
          { kind: 'harder', to: 'a' },
          { kind: 'harder', to: 'z' },
        ],
      },
    };
    expect(rankAlternatives(target, ctx)).toEqual(result);
  });
});

describe('candidate discovery, audit filtering and intent', () => {
  it('preserves optional analytical families in the catalogue schema', () => {
    const entry = (comparisonFamily: string | null | undefined) => ({
      ...CATALOG.crunch!,
      comparisonFamily,
    });
    expect(exerciseSchema.parse(entry('test')).comparisonFamily).toBe('test');
    expect(exerciseSchema.parse(entry(null)).comparisonFamily).toBeNull();
    expect(exerciseSchema.parse(entry(undefined)).comparisonFamily).toBeUndefined();
    expect(exerciseSchema.safeParse(entry('')).success).toBe(false);
  });
  it('unites authored/inverse graph edges, substitutes, slot siblings and explicit analytical families once', () => {
    const { snap, ctx, target } = pool(
      [
        exercise('easy', { progressions: [{ kind: 'harder', to: 'source' }] }),
        exercise('hard'),
        exercise('sibling'),
        exercise('family', { comparisonFamily: 'test' }),
      ],
      exercise('source', {
        comparisonFamily: 'test',
        progressions: [{ kind: 'harder', to: 'hard' }],
        substituteIds: ['easy', 'source', 'missing', 'easy'],
      }),
    );
    const result = rankAlternatives(target, { ...ctx, maxAlternatives: 10 });
    expect(result).toHaveLength(3);
    expect(result.find((r) => r.exerciseId === 'easy')!.why).toEqual(
      expect.arrayContaining(['variant_easier', 'substitute', 'same_slot']),
    );
    expect(result.find((r) => r.exerciseId === 'hard')!.why).toContain('variant_harder');
    snap.slots = snap.slots.map((s) =>
      s.id === 'test' ? { ...s, exerciseIds: ['source', 'family'] } : s,
    );
    expect(rankAlternatives(target, ctx).find((r) => r.exerciseId === 'family')!.why).toContain(
      'same_family',
    );
  });

  it('discards archived/unknown/self ids and every audited hard failure, even with preferred equipment', () => {
    const { snap, ctx, target } = pool([
      exercise('archived', { archived: true }),
      exercise('excluded'),
      exercise('equipment', { equipment: ['band'] }),
      exercise('safe', { primaryMuscles: ['calves'] }),
      exercise('pain'),
    ]);
    snap.eligibility = {
      ...snap.eligibility,
      excludedIds: new Set(['excluded']),
      equipment: ['bodyweight', 'mat'],
    };
    snap.preferences.equipment.band = 'prefer';
    snap.constraints = [
      {
        id: 'pain',
        kind: 'avoid_muscle',
        muscles: ['core'],
        from: snap.asOf,
        until: snap.asOf,
        reason: 'pain',
        source: 'user',
        note: null,
      },
    ];
    snap.slots.at(-1)!.exerciseIds.push('unknown', 'source');
    expect(ids(rankAlternatives(target, ctx))).toEqual(['safe']);
  });

  it('keeps explicit add counts and position and re-assesses the exact selected intent', () => {
    const { ctx, target } = pool([exercise('a')]);
    ctx.change = { kind: 'add_exercise', exercise: { id: 'source' }, sets: 4, position: 'end' };
    const alt = rankAlternatives(target, ctx)[0]!;
    expect(alt.change).toEqual({
      kind: 'add_exercise',
      exercise: { id: 'a' },
      sets: 4,
      position: 'end',
    });
    expect(alt.prescription.sets).toBe(4);
    expect(alt.assessment.patch!.ops[0]).toMatchObject({ kind: 'insertExposure', position: 'end' });
  });

  it('swaps only pending sets and preserves done ids and actual', () => {
    const { snap, session } = world([recipe('crunch', 3)]);
    session.records = perform(session, 1);
    const intent = {
      kind: 'swap_remaining' as const,
      exposureId: session.plan.exposures[0]!.id,
      exercise: { id: 'crunch' },
    };
    const a = assessSessionChange(snap, session, intent);
    expect(a.alternatives.length).toBeGreaterThan(0);
    const done = session.plan.exposures[0]!.sets[0]!;
    for (const alt of a.alternatives) {
      expect(alt.change).toMatchObject({ kind: 'swap_remaining', exposureId: intent.exposureId });
      expect(alt.prescription.sets).toBe(2);
      expect(alt.assessment.patch!.plan.exposures.flatMap((e) => e.sets)).toContainEqual(done);
    }
    session.records = perform(session);
    expect(assessSessionChange(snap, session, intent).alternatives).toEqual([]);
  });

  it('uses a not-found movement hint honestly; an unrelated query has no alternatives', () => {
    const { snap, session } = world();
    const a = assessSessionChange(snap, session, {
      kind: 'add_exercise',
      exercise: { query: 'wyciskanie hantli zza głowy' },
    });
    expect(a.verdict).toBe('blocked');
    expect(a.patch).toBeNull();
    expect(a.resolved.kind).toBe('not_found');
    expect(a.alternatives).toHaveLength(3);
    for (const alt of a.alternatives)
      expect(snap.catalog[alt.exerciseId]!.primaryMuscles).toContain('shoulders');
    expect(
      assessSessionChange(snap, session, {
        kind: 'add_exercise',
        exercise: { query: 'abrakadabra' },
      }).alternatives,
    ).toEqual([]);
    expect(
      assessSessionChange(snap, session, { kind: 'add_exercise', exercise: { id: 'missing' } })
        .alternatives,
    ).toEqual([]);
  });

  it('offers no arbitrary alternatives for ambiguous names or non-exercise mutations', () => {
    const { snap, session } = world([recipe('crunch')]);
    snap.catalog = {
      ...snap.catalog,
      first: exercise('first', { name: 'Remis' }),
      second: exercise('second', { name: 'Remis' }),
    };
    expect(
      assessSessionChange(snap, session, { kind: 'add_exercise', exercise: { query: 'Remis' } })
        .alternatives,
    ).toEqual([]);
    expect(
      assessSessionChange(snap, session, {
        kind: 'skip_remaining',
        exposureId: session.plan.exposures[0]!.id,
      }).alternatives,
    ).toEqual([]);
  });

  it('supports a slot-only target without fabricated biomechanics or catalogue families', () => {
    const { ctx } = pool([exercise('a')]);
    expect(ids(rankAlternatives({ slotId: 'test', muscles: [] }, ctx))).toEqual(['source', 'a']);
    expect(rankAlternatives({ slotId: 'unknown', muscles: [] }, ctx)).toEqual([]);
    expect(rankAlternatives({ exerciseId: 'unknown', muscles: [] }, ctx)).toEqual([]);
  });

  it('supports a missing optional graph and family with a recipe-less source', () => {
    const { snap, ctx, target } = pool(
      [exercise('a')],
      exercise('source', {
        progressions: undefined,
        comparisonFamily: undefined,
        substituteIds: ['a'],
      }),
    );
    snap.slots = snap.slots.map((s) => ({
      ...s,
      exerciseIds: s.exerciseIds.filter((id) => id !== 'source'),
    }));
    expect(ids(rankAlternatives(target, ctx))).toEqual(['a']);
    expect(assessSessionChange(snap, ctx.session, ctx.change).alternatives).toEqual(
      rankAlternatives(target, ctx),
    );
  });

  it('applies an equipment filter without treating a preference as a restriction', () => {
    const { ctx, target } = pool([exercise('band', { equipment: ['band'] }), exercise('body')]);
    expect(ids(rankAlternatives(target, { ...ctx, equipmentFamily: 'band' }))).toEqual(['band']);
    expect(
      ids(
        assessSessionChange(ctx.snap, ctx.session, ctx.change, { equipmentFamily: 'band' })
          .alternatives,
      ),
    ).toEqual(['band']);
  });

  it.each([0, -1, NaN, Infinity, 0.5])(
    'disables alternative evaluation for limit %s',
    (maxAlternatives) => {
      const { ctx, target } = pool([exercise('a')]);
      expect(rankAlternatives(target, { ...ctx, maxAlternatives })).toEqual([]);
    },
  );

  it('caps output at three and permits a smaller integer limit', () => {
    const { ctx, target } = pool(['a', 'b', 'c', 'd'].map((id) => exercise(id)));
    expect(rankAlternatives(target, { ...ctx, maxAlternatives: 1.9 })).toHaveLength(1);
    expect(rankAlternatives(target, { ...ctx, maxAlternatives: 100 })).toHaveLength(3);
  });
});
