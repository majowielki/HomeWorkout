/**
 * Engine v2, P4 (04 §6-§7, T08, T09, T41, T46): one compiler from recipes to a
 * session plan.
 */
import { compileSession, stampPlan } from '../plan/compile';
import { sessionPlanSchema, type ExecutionStep } from '../plan/plan';
import { compileInput, exposure, kg, set, single, stamp, body } from './compileFixtures';
import { HASH_A } from './planFixtures';

const kinds = (steps: readonly ExecutionStep[]) => steps.map((s) => s.kind);
const performs = (steps: readonly ExecutionStep[]) =>
  steps.flatMap((s) => (s.kind === 'perform' ? [s.plannedSetId] : []));

describe('a plan from one exposure', () => {
  const plan = compileSession(compileInput([exposure('e1')]));

  it('has the planned sets with stable ids, and the steps in order', () => {
    expect(plan.exposures[0]!.id).toBe('s1/r1/e1');
    expect(plan.exposures[0]!.sets.map((s) => s.id)).toEqual(['s1/r1/e1/1', 's1/r1/e1/2']);
    expect(kinds(plan.execution.steps)).toEqual(['transition', 'perform', 'rest', 'perform']);
    expect(performs(plan.execution.steps)).toEqual(['s1/r1/e1/1', 's1/r1/e1/2']);
  });

  it('has no rest after the last set', () => {
    expect(plan.execution.steps.at(-1)!.kind).toBe('perform');
  });

  it('counts the time in categories that add up, the bike apart', () => {
    expect(plan.time).toEqual({
      hardWork: 80,
      practice: 0,
      mobility: 0,
      warmup: 0,
      rest: 60,
      setup: 0,
      transition: 30,
      exerciseTotal: 170,
      bike: 600,
      overall: 770,
    });
  });

  it('is a plan the schema accepts once it has been stamped', () => {
    expect(sessionPlanSchema.safeParse(stamp(plan)).success).toBe(true);
  });

  it('carries the target with the bottom of the range and the aim inside it', () => {
    expect(plan.exposures[0]!.sets[0]).toMatchObject({
      role: 'work',
      side: 'bilateral',
      ordinal: 1,
      requiredForProgression: true,
      comparisonGroupId: 's1/r1/e1/work',
      target: { kind: 'reps', min: 8, target: 10, max: 12, count: 'total' },
    });
  });

  it('keeps the aim inside the range: a target under the bottom lowers the bottom (a build-up)', () => {
    const built = compileSession(
      compileInput([exposure('e1', { sets: [set({ lo: 8, target: 5 })] })]),
    );
    expect(built.exposures[0]!.sets[0]!.target).toMatchObject({ min: 5, target: 5, max: 12 });
  });
});

describe('the stamp', () => {
  it('binds the audit to the plan: the hash changes with the plan, not with the same plan again', () => {
    const a = compileSession(compileInput([exposure('e1')]));
    const b = compileSession(compileInput([exposure('e1', { sets: [set(), set(), set()] })]));
    expect(stamp(a).audit.planHash).toBe(
      stamp(compileSession(compileInput([exposure('e1')]))).audit.planHash,
    );
    expect(stamp(a).audit.planHash).not.toBe(stamp(b).audit.planHash);
    expect(stamp(a).audit.planHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('carries the mode, the inputs and the advice that was confirmed', () => {
    const plan = stampPlan(compileSession(compileInput([exposure('e1')])), {
      mode: 'start_session',
      snapshotFingerprint: HASH_A,
      overrides: ['DAY_MAX_EXCEEDED'],
    });
    expect(plan.audit).toMatchObject({ mode: 'start_session', overrides: ['DAY_MAX_EXCEEDED'] });
  });
});

describe('T08 the ids of the sets do not depend on the order of the exercises', () => {
  it('two exercises swapped keep their sets, and each result its own set', () => {
    const forward = compileSession(compileInput([exposure('e1'), exposure('e2')]));
    const backward = compileSession(compileInput([exposure('e2'), exposure('e1')]));
    const ids = (p: typeof forward, key: string) =>
      p.exposures.find((e) => e.id.endsWith(key))!.sets.map((s) => s.id);
    expect(ids(forward, 'e1')).toEqual(ids(backward, 'e1'));
    expect(ids(forward, 'e2')).toEqual(ids(backward, 'e2'));
    expect(performs(forward.execution.steps)).not.toEqual(performs(backward.execution.steps));
    expect([...performs(forward.execution.steps)].sort()).toEqual(
      [...performs(backward.execution.steps)].sort(),
    );
  });
});

describe('T08, T09 sides', () => {
  it('one side per set: a logical set is two planned sets, left first or right first', () => {
    const left = compileSession(
      compileInput([exposure('e1', { sideMode: 'per_set', sets: [set(), set()] })]),
    );
    expect(left.exposures[0]!.sets.map((s) => s.id)).toEqual([
      's1/r1/e1/1L',
      's1/r1/e1/1R',
      's1/r1/e1/2L',
      's1/r1/e1/2R',
    ]);
    expect(performs(left.execution.steps)).toEqual(left.exposures[0]!.sets.map((s) => s.id));
    const right = compileSession(
      compileInput([exposure('e1', { sideMode: 'per_set', firstSide: 'right', sets: [set()] })]),
    );
    expect(right.exposures[0]!.sets.map((s) => s.id)).toEqual(['s1/r1/e1/1R', 's1/r1/e1/1L']);
    expect(sessionPlanSchema.safeParse(stamp(left)).success).toBe(true);
    expect(sessionPlanSchema.safeParse(stamp(right)).success).toBe(true);
  });

  it('both sides in one set: the count is per side and the work takes twice as long', () => {
    const plan = compileSession(
      compileInput([exposure('e1', { sideMode: 'both', sets: [set({ target: 10 })] })]),
    );
    expect(plan.exposures[0]!.sets[0]!.target).toMatchObject({ kind: 'reps', count: 'per_side' });
    expect(plan.time.hardWork).toBe(80);
  });

  it('alternating inside the set: the count is for the whole set', () => {
    const plan = compileSession(
      compileInput([exposure('e1', { sideMode: 'alternating', sets: [set({ target: 10 })] })]),
    );
    expect(plan.exposures[0]!.sets[0]).toMatchObject({
      side: 'alternating',
      target: { kind: 'reps', count: 'total' },
    });
    expect(plan.time.hardWork).toBe(40);
  });

  it('a hold is counted in seconds', () => {
    const plan = compileSession(
      compileInput([
        exposure('e1', {
          unit: 'duration',
          sets: [set({ resistance: body, lo: 20, target: 40, hi: 60 })],
        }),
      ]),
    );
    expect(plan.exposures[0]!.sets[0]!.target).toEqual({
      kind: 'duration',
      minSec: 20,
      targetSec: 40,
      maxSec: 60,
    });
    expect(plan.execution.steps.find((s) => s.kind === 'perform')).toMatchObject({
      mode: 'duration',
    });
    expect(plan.time.hardWork).toBe(40);
  });
});

describe('roles', () => {
  it('only a working set can be required; the others are counted apart', () => {
    const plan = compileSession(
      compileInput([
        exposure('e1', {
          sets: [
            set({ role: 'warmup', required: true, target: 5 }),
            set({ role: 'work' }),
            set({ role: 'practice', required: false, target: 5 }),
            set({ role: 'mobility', required: false, target: 5 }),
            set({ role: 'backoff', required: false }),
          ],
        }),
      ]),
    );
    expect(plan.exposures[0]!.sets.map((s) => s.requiredForProgression)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(plan.time).toMatchObject({ warmup: 20, practice: 20, mobility: 20, hardWork: 80 });
    expect(sessionPlanSchema.safeParse(stamp(plan)).success).toBe(true);
  });

  it('a band is stretched first: a cue, and the time in the warm-up', () => {
    const plan = compileSession(compileInput([exposure('e1', { bandWarmup: true })]));
    expect(kinds(plan.execution.steps).slice(0, 3)).toEqual(['transition', 'cue', 'perform']);
    expect(plan.time.warmup).toBe(60);
  });
});

describe('supersets (04 §6)', () => {
  it('are done round by round, and the tail of the longer one in order', () => {
    const plan = compileSession(
      compileInput([
        exposure('e1', { group: 'A', sets: [set(), set()] }),
        exposure('e2', { group: 'A', sets: [set(), set(), set()] }),
        exposure('e3'),
      ]),
    );
    expect(performs(plan.execution.steps).map((id) => id.replace('s1/r1/', ''))).toEqual([
      'e1/1',
      'e2/1',
      'e1/2',
      'e2/2',
      'e2/3',
      'e3/1',
      'e3/2',
    ]);
  });

  it('do the probe set first and on its own, then go round by round (ENG-06)', () => {
    const probe = set({ role: 'probe', resistance: kg(6), required: false });
    const plan = compileSession(
      compileInput([
        exposure('e1', { group: 'A', sets: [probe, set(), set()] }),
        exposure('e2', { group: 'A', sets: [set(), set(), set()] }),
      ]),
    );
    expect(performs(plan.execution.steps).map((id) => id.replace('s1/r1/', ''))).toEqual([
      'e1/1',
      'e1/2',
      'e2/1',
      'e1/3',
      'e2/2',
      'e2/3',
    ]);
    // The probe is done before its partner has had a turn.
    const kindsOf = plan.exposures[0]!.sets.map((s) => s.role);
    expect(kindsOf).toEqual(['probe', 'work', 'work']);
  });

  it('never repeat an exercise while the other has something to do', () => {
    const plan = compileSession(
      compileInput([
        exposure('e1', { group: 'A', sets: [set()] }),
        exposure('e2', { group: 'A', sets: [set(), set(), set()] }),
      ]),
    );
    expect(performs(plan.execution.steps).map((id) => id.replace('s1/r1/', ''))).toEqual([
      'e1/1',
      'e2/1',
      'e2/2',
      'e2/3',
    ]);
  });

  it('are not invented: the sets are exactly the sets of the recipes, each once', () => {
    const plan = compileSession(
      compileInput([
        exposure('e1', { group: 'A', sets: [set()] }),
        exposure('e2', { group: 'A', sets: [set(), set()] }),
      ]),
    );
    expect(performs(plan.execution.steps)).toHaveLength(3);
    expect(sessionPlanSchema.safeParse(stamp(plan)).success).toBe(true);
  });
});

describe('T46 one pair of adjustable dumbbells', () => {
  const pair = (key: string, mass: number, sets = 2) =>
    exposure(key, {
      group: 'A',
      sets: Array.from({ length: sets }, () => set({ resistance: kg(mass) })),
    });
  const one = (key: string, mass: number, sets = 2) =>
    exposure(key, {
      group: 'A',
      comparisonKey: `${key}|dumbbell.single`,
      sets: Array.from({ length: sets }, () => set({ resistance: single(mass) })),
    });

  it('a superset that needs two set-ups of them pays for every return, not for the first start', () => {
    const plan = compileSession(compileInput([pair('e1', 8), one('e2', 14)]));
    const setups = plan.execution.steps.filter((s) => s.kind === 'setup');
    expect(setups).toHaveLength(2);
    expect(setups[0]).toMatchObject({
      resources: [{ resourceId: 'dumbbell-set', quantity: 2, configuration: 'paired:8000' }],
      estimatedSec: 30,
    });
    expect(plan.time.setup).toBe(60);
  });

  it('the same two done one after the other need no set-up between the sets', () => {
    const plan = compileSession(
      compileInput([
        exposure('e1', { sets: [set({ resistance: kg(8) }), set({ resistance: kg(8) })] }),
        exposure('e2', {
          comparisonKey: 'e2|dumbbell.single',
          sets: [set({ resistance: single(14) }), set({ resistance: single(14) })],
        }),
      ]),
    );
    expect(plan.execution.steps.filter((s) => s.kind === 'setup')).toHaveLength(0);
  });

  it('a probe at the next step needs the equipment changed back for the others', () => {
    const plan = compileSession(
      compileInput([
        exposure('e1', {
          sets: [
            set({ role: 'probe', required: false, resistance: kg(6) }),
            set({ resistance: kg(4) }),
          ],
        }),
      ]),
    );
    expect(plan.execution.steps.filter((s) => s.kind === 'setup')).toHaveLength(1);
    expect(plan.time.setup).toBe(30);
  });

  it('equipment that needs nothing, or that the compiler does not know, costs nothing', () => {
    const plan = compileSession(
      compileInput([
        exposure('e1', {
          sets: [set({ resistance: body }), set({ resistance: { ...body, modelId: 'unknown' } })],
        }),
      ]),
    );
    expect(plan.execution.steps.some((s) => s.kind === 'setup')).toBe(false);
  });
});

describe('the whole plan', () => {
  it('has no bike when there is none, and the overall time is the exercises and the ride', () => {
    const plan = compileSession(compileInput([exposure('e1')], { bikeSec: 0 }));
    expect(plan.time.overall).toBe(plan.time.exerciseTotal);
    expect(sessionPlanSchema.safeParse(stamp(plan)).success).toBe(true);
  });

  it('a plan without exposures has no steps and no time', () => {
    const plan = compileSession(compileInput([], { bikeSec: 0 }));
    expect(plan.execution.steps).toEqual([]);
    expect(plan.time.overall).toBe(0);
  });
});
