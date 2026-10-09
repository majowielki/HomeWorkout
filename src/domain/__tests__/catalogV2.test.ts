/**
 * Engine v2, P1 (05 §3, §12-§14, 07 P1.4): what the catalogue says about an
 * exercise beyond the old fields — equipment family, joints, rep cap, weights,
 * the graph of variants — and the checks that keep that data honest.
 */
import exercisesJson from '@data/exercises.json';
import slotsJson from '@data/slots.json';
import { exerciseCatalogueSchema } from '@data/exercises.schema';
import { slotCatalogueSchema } from '@data/slots.schema';

import { equipmentFamilyOf, loadsJoint, repCapOf, secondaryWeightOf } from '../catalog/attributes';
import { catalogueProblems } from '../catalog/validate';
import { buildVariantGraph, nextVariant } from '../catalog/variants';
import type { EligibilityContext } from '../plan/eligibility';
import type { Exercise } from '../types';
import { CONSERVATIVE, exercise, HARD_ONLY, slot } from './fixtures';

const real = exerciseCatalogueSchema.parse(exercisesJson).exercises as Exercise[];
const realSlots = slotCatalogueSchema.parse(slotsJson).slots;
const byId = Object.fromEntries(real.map((e) => [e.id, e]));
const open: EligibilityContext = { profile: HARD_ONLY, excludedIds: new Set() };

describe('what an exercise says about itself', () => {
  it('names the implement the resistance comes from', () => {
    const family = (equipment: Exercise['equipment']) => equipmentFamilyOf({ equipment });
    expect(family(['band', 'mat'])).toBe('band');
    expect(family(['dumbbell', 'bodyweight'])).toBe('dumbbell');
    expect(family(['band', 'dumbbell'])).toBe('band');
    expect(family(['mini-band', 'mat'])).toBe('mini-band');
    expect(family(['bike'])).toBe('bike');
    expect(family(['mat', 'bodyweight'])).toBe('bodyweight');
    expect(equipmentFamilyOf(byId['goblet-squat']!)).toBe('dumbbell');
    expect(equipmentFamilyOf(byId['band-row']!)).toBe('band');
    expect(equipmentFamilyOf(byId['plank']!)).toBe('bodyweight');
  });

  it('says whether a joint is loaded: the knee as classified, any other as unknown until told', () => {
    expect(loadsJoint({ loadsKnee: true }, 'knee')).toBe(true);
    expect(loadsJoint({ loadsKnee: false, jointLoading: { knee: true } }, 'knee')).toBe(false);
    expect(loadsJoint({ loadsKnee: false }, 'shoulder')).toBe('unknown');
    expect(loadsJoint({ loadsKnee: false, jointLoading: { shoulder: true } }, 'shoulder')).toBe(
      true,
    );
    expect(loadsJoint({ loadsKnee: false, jointLoading: { wrist: false } }, 'wrist')).toBe(false);
  });

  it('T98 caps the repetitions at 25, and at 20 where the knee is loaded', () => {
    expect(repCapOf({ loadsKnee: false })).toBe(25);
    expect(repCapOf({ loadsKnee: true })).toBe(20);
    expect(repCapOf({ loadsKnee: true }, { default: 30, kneeLoading: 15 })).toBe(15);
    expect(repCapOf(byId['goblet-squat']!)).toBe(20);
    expect(repCapOf(byId['push-up']!)).toBe(25);
  });

  it('T95 weighs a secondary muscle: the person, then the catalogue, then the policy', () => {
    const row = { secondaryWeights: { biceps: 0.5, shoulders: 0.25 } };
    expect(secondaryWeightOf(row, 'shoulders')).toBe(0.25);
    expect(secondaryWeightOf(row, 'shoulders', { shoulders: 0.4 })).toBe(0.4);
    expect(secondaryWeightOf(row, 'core')).toBe(0.5);
    expect(secondaryWeightOf({}, 'core', undefined, 0.3)).toBe(0.3);
    expect(secondaryWeightOf(row, 'shoulders', { shoulders: 0 })).toBe(0);
  });
});

describe('the graph of variants', () => {
  const chain = [
    exercise({ id: 'a', progressions: [{ to: 'b', kind: 'harder' }] }),
    exercise({ id: 'b', progressions: [{ to: 'c', kind: 'harder' }] }),
    exercise({ id: 'c' }),
  ];

  it('adds the inverse of every edge it is told', () => {
    const graph = buildVariantGraph(chain);
    expect(graph.harder.get('a')).toEqual(['b']);
    expect(graph.harder.get('b')).toEqual(['c']);
    expect(graph.easier.get('b')).toEqual(['a']);
    expect(graph.easier.get('c')).toEqual(['b']);
    expect(graph.easier.get('a')).toBeUndefined();
  });

  it('accepts an edge written from either end, and keeps each once', () => {
    const both = [
      exercise({ id: 'a', progressions: [{ to: 'b', kind: 'harder' }] }),
      exercise({ id: 'b', progressions: [{ to: 'a', kind: 'easier' }] }),
    ];
    const graph = buildVariantGraph(both);
    expect(graph.harder.get('a')).toEqual(['b']);
    expect(graph.easier.get('b')).toEqual(['a']);
    const down = buildVariantGraph([
      exercise({ id: 'x', progressions: [{ to: 'y', kind: 'easier' }] }),
    ]);
    expect(down.easier.get('x')).toEqual(['y']);
    expect(down.harder.get('y')).toEqual(['x']);
  });

  it('puts the authored edges of an exercise before the inverses of other people’s', () => {
    const graph = buildVariantGraph([
      exercise({ id: 'x', progressions: [{ to: 'y', kind: 'harder' }] }),
      exercise({ id: 'y', progressions: [{ to: 'z', kind: 'harder' }] }),
      exercise({ id: 'w', progressions: [{ to: 'y', kind: 'harder' }] }),
    ]);
    expect(graph.easier.get('y')).toEqual(['x', 'w']);
  });

  describe('nextVariant', () => {
    const catalog = Object.fromEntries(chain.map((e) => [e.id, e]));
    const graph = buildVariantGraph(chain);

    it('goes one step in the direction asked, and stops at the end', () => {
      expect(nextVariant('a', 'harder', graph, catalog, open)?.id).toBe('b');
      expect(nextVariant('c', 'easier', graph, catalog, open)?.id).toBe('b');
      expect(nextVariant('c', 'harder', graph, catalog, open)).toBeNull();
      expect(nextVariant('a', 'easier', graph, catalog, open)).toBeNull();
      expect(nextVariant('nobody', 'harder', graph, catalog, open)).toBeNull();
    });

    it('never offers what the plan could not contain: excluded, archived, or unknown to the catalogue', () => {
      expect(
        nextVariant('a', 'harder', graph, catalog, { ...open, excludedIds: new Set(['b']) }),
      ).toBeNull();
      const archived = { ...catalog, b: { ...catalog.b!, archived: true } };
      expect(nextVariant('a', 'harder', graph, archived, open)).toBeNull();
      const missing = { a: catalog.a! };
      expect(nextVariant('a', 'harder', graph, missing, open)).toBeNull();
    });

    it('skips a variant the knee rules out and takes the next eligible one', () => {
      const lunge = exercise({
        id: 'hard-1',
        loadsKnee: true,
        provokesValgusVarus: true,
        stanceMechanics: 'UnilateralSupported',
        isClosedKineticChain: true,
      });
      const safe = exercise({ id: 'hard-2' });
      const root = exercise({
        id: 'root',
        progressions: [
          { to: 'hard-1', kind: 'harder' },
          { to: 'hard-2', kind: 'harder' },
        ],
      });
      const all = [root, lunge, safe];
      const g = buildVariantGraph(all);
      const cat = Object.fromEntries(all.map((e) => [e.id, e]));
      const pick = (profile: EligibilityContext['profile']) =>
        nextVariant('root', 'harder', g, cat, { profile, excludedIds: new Set() })?.id;
      expect(pick(CONSERVATIVE)).toBe('hard-2');
      expect(pick({ knee: null })).toBe('hard-1');
    });

    it('prefers the higher score, then the order of the catalogue', () => {
      const root = exercise({
        id: 'root',
        progressions: [
          { to: 'p', kind: 'harder' },
          { to: 'q', kind: 'harder' },
          { to: 'r', kind: 'harder' },
        ],
      });
      const all = [root, exercise({ id: 'p' }), exercise({ id: 'q' }), exercise({ id: 'r' })];
      const g = buildVariantGraph(all);
      const cat = Object.fromEntries(all.map((e) => [e.id, e]));
      expect(nextVariant('root', 'harder', g, cat, open)?.id).toBe('p');
      expect(
        nextVariant('root', 'harder', g, cat, open, (e) =>
          e.id === 'r' ? 2 : e.id === 'q' ? 1 : 0,
        )?.id,
      ).toBe('r');
      expect(
        nextVariant('root', 'harder', g, cat, open, (e) => (e.id === 'q' || e.id === 'r' ? 1 : 0))
          ?.id,
      ).toBe('q');
    });
  });
});

describe('catalogueProblems', () => {
  const core = slot({ id: 'core-front', kind: 'core', exerciseIds: ['plank', 'kneeling', 'hold'] });
  const chest = slot({ id: 'chest', exerciseIds: ['push-up', 'knee-push-up'] });
  const pushing = (id: string, patch: Partial<Exercise> = {}) =>
    exercise({ id, primaryMuscles: ['chest'], ...patch });
  const check = (exercises: Exercise[], slots = [core, chest]) =>
    catalogueProblems(exercises, slots);

  it('finds nothing wrong with a sound pair of variants', () => {
    const problems = check([
      pushing('knee-push-up', { progressions: [{ to: 'push-up', kind: 'harder' }] }),
      pushing('push-up'),
    ]);
    expect(problems.errors).toEqual([]);
    expect(problems.warnings).toEqual([]);
  });

  it('refuses an edge to nowhere, to itself, or written twice', () => {
    const { errors } = check([
      pushing('a', {
        progressions: [
          { to: 'ghost', kind: 'harder' },
          { to: 'a', kind: 'harder' },
          { to: 'b', kind: 'harder' },
          { to: 'b', kind: 'harder' },
        ],
      }),
      pushing('b'),
    ]);
    expect(errors).toEqual([
      'a harder -> ghost: no such exercise',
      'a harder -> a: an exercise cannot be its own variant',
      'a harder -> b: written twice',
    ]);
  });

  it('refuses variants counted differently, or with no muscle in common', () => {
    const { errors } = check([
      pushing('reps', { progressions: [{ to: 'held', kind: 'harder' }] }),
      pushing('held', { forceProfile: 'Isometric' }),
      pushing('legs', {
        primaryMuscles: ['quads'],
        progressions: [{ to: 'reps', kind: 'easier' }],
      }),
    ]);
    expect(errors).toEqual([
      'reps harder -> held: one is counted in reps, the other in sec',
      'legs easier -> reps: no primary muscle in common',
    ]);
  });

  it('refuses a variant that is harder than the one it is easier than, and a circle', () => {
    const contradiction = check([
      pushing('a', {
        progressions: [
          { to: 'b', kind: 'harder' },
          { to: 'b', kind: 'easier' },
        ],
      }),
      pushing('b'),
    ]).errors;
    expect(contradiction).toContain('a and b: each is called the harder of the other');
    const circle = check([
      pushing('a', { progressions: [{ to: 'b', kind: 'harder' }] }),
      pushing('b', { progressions: [{ to: 'c', kind: 'harder' }] }),
      pushing('c', { progressions: [{ to: 'a', kind: 'harder' }] }),
    ]).errors;
    expect(circle.filter((e) => e.startsWith('harder variants go in a circle'))).toHaveLength(1);
    expect(circle[0]).toContain('a -> b -> c -> a');
  });

  it('warns about an edge that leaves its slot', () => {
    const { warnings } = check([
      pushing('push-up', {
        progressions: [{ to: 'plank', kind: 'harder' }],
        primaryMuscles: ['core', 'chest'],
      }),
      exercise({ id: 'plank', primaryMuscles: ['core'] }),
    ]);
    expect(warnings).toContain('push-up harder -> plank: leaves the slot chest for core-front');
  });

  it('warns about a core exercise with no way down — the others it leaves alone', () => {
    const { warnings } = check([
      exercise({
        id: 'plank',
        primaryMuscles: ['core'],
        progressions: [{ to: 'hold', kind: 'harder' }],
      }),
      exercise({
        id: 'kneeling',
        primaryMuscles: ['core'],
        progressions: [{ to: 'plank', kind: 'harder' }],
      }),
      exercise({
        id: 'hold',
        primaryMuscles: ['core'],
        equipment: ['dumbbell'],
        dumbbellMode: 'single',
      }),
    ]);
    expect(warnings).toEqual([
      'kneeling: a core exercise with no easier variant (NO_EASIER_VARIANT)',
    ]);
    const retired = check([exercise({ id: 'plank', primaryMuscles: ['core'], archived: true })]);
    expect(retired.warnings).toEqual([]);
    const notCore = check([pushing('push-up')]);
    expect(notCore.warnings).toEqual([]);
  });

  it('notes a bodyweight exercise at its ceiling, but not a loaded, retired, mobility or cardio one', () => {
    const { info } = check([
      pushing('push-up', { progressions: [{ to: 'harder-push-up', kind: 'harder' }] }),
      pushing('harder-push-up'),
      pushing('dumbbell-press', { equipment: ['dumbbell'], dumbbellMode: 'paired' }),
      pushing('band-press', { equipment: ['band'] }),
      pushing('mini-press', { equipment: ['mini-band'] }),
      pushing('old', { archived: true }),
      pushing('stretch', { movementPattern: 'Mobility' }),
      pushing('ride', { movementPattern: 'Cardio', equipment: ['bike'] }),
    ]);
    expect(info).toEqual(['harder-push-up: bodyweight with no harder variant (the ceiling)']);
  });

  it('refuses an alias that already means something else, or means nothing', () => {
    const { errors } = check([
      pushing('push-up', { name: 'Pompka', aliases: ['pompki', 'Pompka klasyczna'] }),
      pushing('knee-push-up', {
        name: 'Pompka na kolanach',
        aliases: ['POMPKI', 'pompka', ' ', 'pompka-na-kolanach'],
      }),
    ]);
    expect(errors).toEqual([
      'knee-push-up: the alias "POMPKI" already means push-up',
      'knee-push-up: the alias "pompka" already means push-up',
      'knee-push-up: an empty alias',
    ]);
  });

  it('refuses a weight for a muscle that is not a secondary one of the exercise', () => {
    const { errors } = check([
      pushing('row', {
        secondaryMuscles: ['biceps'],
        secondaryWeights: { biceps: 0.5, shoulders: 0.25 },
      }),
    ]);
    expect(errors).toEqual(['row: a weight for shoulders, which is not a secondary muscle of it']);
  });

  it('warns about a group of one, and a group that spans slots', () => {
    const alone = check([pushing('push-up', { equivalenceGroup: 'press' })]);
    expect(alone.warnings).toContain('push-up: the group "press" has no other member');
    const across = check([
      pushing('push-up', { equivalenceGroup: 'press' }),
      exercise({ id: 'plank', primaryMuscles: ['core'], equivalenceGroup: 'press' }),
    ]);
    expect(across.warnings).toContain('push-up: the group "press" spans more than one slot');
    const outside = check([
      pushing('free-1', { equivalenceGroup: 'press' }),
      pushing('free-2', { equivalenceGroup: 'press' }),
    ]);
    expect(outside.warnings).toContain('free-1: the group "press" spans more than one slot');
    const together = check([
      pushing('push-up', { equivalenceGroup: 'press' }),
      pushing('knee-push-up', { equivalenceGroup: 'press' }),
    ]);
    expect(together.warnings.filter((w) => w.includes('press'))).toEqual([]);
  });
});

describe('the shipped catalogue', () => {
  const problems = catalogueProblems(real, realSlots);

  it('has a sound graph of variants, with no error in any v2 field', () => {
    expect(problems.errors).toEqual([]);
  });

  it('gives the bodyweight movements a way up (push-ups, bridges, abs)', () => {
    const graph = buildVariantGraph(real);
    expect(graph.harder.get('push-up')).toEqual(['deadstop-push-up', 'band-push-up']);
    expect(graph.easier.get('push-up')).toEqual(['incline-push-up', 'knee-push-ups']);
    expect(graph.harder.get('glute-bridge')).toEqual(['glute-bridge-march', 'db-glute-bridge']);
    expect(graph.harder.get('boat-hold')).toEqual(['hollow-hold']);
    expect(graph.easier.get('hollow-hold')).toEqual(['boat-hold']);
  });

  it('knows which core exercises still have no easier variant', () => {
    const missing = problems.warnings
      .filter((w) => w.includes('NO_EASIER_VARIANT'))
      .map((w) => w.split(':')[0]);
    // The easiest of their chains legitimately have none; the rest are gaps to fill (UWAGI 3.3).
    expect(missing).toEqual(
      expect.arrayContaining(['kneeling-plank-on-elbows', 'dead-bug-legs-only']),
    );
    expect(missing).not.toContain('plank');
    expect(missing).not.toContain('hollow-hold');
  });

  it('resolves every edge to an exercise a plan could contain for the documented knee', () => {
    const graph = buildVariantGraph(real);
    for (const e of real) {
      for (const direction of ['harder', 'easier'] as const) {
        for (const to of graph[direction].get(e.id) ?? []) expect(byId[to]).toBeDefined();
      }
    }
    expect(nextVariant('push-up', 'harder', graph, byId, open)?.id).toBe('deadstop-push-up');
    expect(nextVariant('push-up', 'easier', graph, byId, open)?.id).toBe('incline-push-up');
  });
});
