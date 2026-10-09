/**
 * Engine v2, P4 (01 §3, T36, T37, T56): mending a plan the audit did not pass, one
 * explicit step at a time, and what planning says when there is nothing to mend.
 */
import { planWithRepair, type PlanningResult } from '../plan/repair';
import type { ExposureSpec } from '../plan/compile';
import { catalogOf, context, day, exposure, kg, set } from './auditFixtures';
import { compileInput, single } from './compileFixtures';
import { HASH_A } from './planFixtures';

const plan = (
  specs: readonly ExposureSpec[],
  ctx = context(),
  options: { acknowledged?: string[]; budget?: number } = {},
): PlanningResult => {
  const { exposures: _e, ...input } = compileInput(specs);
  return planWithRepair(specs, input, ctx, { snapshotFingerprint: HASH_A, ...options });
};
const changesOf = (r: PlanningResult) =>
  r.changes.map((c) => `${c.kind}:${c.exposureKey}:${c.because}`);
const reasonCodes = (r: PlanningResult) => ('reasons' in r ? r.reasons.map((i) => i.code) : []);
const withTime = (sessionSecMax: number | null) => context({ day: day({ sessionSecMax }) });

describe('a plan that needs no mending', () => {
  it('is ready, with the plan stamped and audited', () => {
    const r = plan([exposure('e1')]);
    expect(r.kind).toBe('ready');
    if (r.kind !== 'ready') return;
    expect(r.changes).toEqual([]);
    expect(r.plan.audit).toMatchObject({ mode: 'new_plan', overrides: [] });
    expect(r.plan.exposures).toHaveLength(1);
  });

  it('carries the notes of the audit', () => {
    const r = plan([exposure('e1', { scope: 'supplemental' })]);
    expect(r.kind === 'ready' && r.notes.map((n) => n.code)).toEqual(['SUPPLEMENTAL_ONLY']);
  });
});

describe('T37 mending the time, step by step', () => {
  const pair = exposure('e1', {
    group: 'A',
    sets: [set({ resistance: kg(8) }), set({ resistance: kg(8) })],
  });
  const solo = exposure('e2', {
    group: 'A',
    comparisonKey: 'e2|dumbbell.single',
    sets: [set({ resistance: single(14) }), set({ resistance: single(14) })],
  });

  it('a filler goes first, the last of them', () => {
    const r = plan(
      [exposure('e1'), exposure('e2', { filler: true }), exposure('e3', { filler: true })],
      withTime(260),
    );
    expect(r.kind).toBe('adjusted');
    expect(changesOf(r)).toEqual([
      'drop_filler:e3:TIME_OVER_BUDGET',
      'drop_filler:e2:TIME_OVER_BUDGET',
    ]);
    expect(r.kind === 'adjusted' && r.plan.exposures.map((e) => e.id)).toEqual(['s1/r1/e1']);
  });

  it('then a superset is split, which spares the changeovers', () => {
    const r = plan([pair, solo], withTime(450));
    expect(changesOf(r)).toEqual(['split_superset:null:TIME_OVER_BUDGET']);
    expect(r.kind === 'adjusted' && r.plan.time.setup).toBe(0);
  });

  it('only the superset is split, whatever else is in the plan', () => {
    const specs = [pair, solo, exposure('e3', { sets: [set()] })];
    const whole = plan(specs, withTime(null));
    if (whole.kind !== 'ready') throw new Error('plan');
    const r = plan(specs, withTime(whole.plan.time.exerciseTotal - 30));
    expect(changesOf(r)).toEqual(['split_superset:null:TIME_OVER_BUDGET']);
    expect(r.kind === 'adjusted' && r.plan.exposures).toHaveLength(3);
  });

  it('a superset with no changeover in it is not split to save time', () => {
    const calm = [exposure('e1', { group: 'A' }), exposure('e2', { group: 'A' })];
    const r = plan(calm, withTime(300));
    expect(changesOf(r).every((c) => !c.startsWith('split_superset'))).toBe(true);
  });

  it('then a set is taken from the exposure with the most, the later one first', () => {
    const r = plan(
      [exposure('e1', { sets: [set(), set()] }), exposure('e2', { sets: [set(), set(), set()] })],
      withTime(480),
    );
    expect(r.kind).toBe('adjusted');
    expect(changesOf(r)[0]).toBe('reduce_sets:e2:TIME_OVER_BUDGET');
  });

  it('a set is never taken below one, and a probe stays', () => {
    const probe = exposure('e1', {
      sets: [
        set({ role: 'probe', required: false, resistance: kg(6) }),
        set({ resistance: kg(4) }),
        set({ resistance: kg(4) }),
      ],
    });
    const r = plan([probe], withTime(200));
    expect(r.kind).toBe('adjusted');
    if (r.kind !== 'adjusted') return;
    expect(r.plan.exposures[0]!.sets.map((s) => s.role)).toEqual(['probe', 'work']);
  });

  it('then an exercise goes, the last of the plan', () => {
    const r = plan(
      [exposure('e1', { sets: [set()] }), exposure('e2', { sets: [set()] })],
      withTime(110),
    );
    expect(changesOf(r)).toEqual(['drop_exposure:e2:TIME_OVER_BUDGET']);
    expect(r.kind === 'adjusted' && r.plan.exposures).toHaveLength(1);
  });

  it('every step is audited again: the plan that comes out passes', () => {
    const r = plan([pair, solo, exposure('e3', { filler: true })], withTime(300));
    expect(r.kind).toBe('adjusted');
  });
});

describe('T36 nothing can be made', () => {
  it('a rest day: no plan, and the reason, with nothing mended', () => {
    const r = plan([exposure('e1')], context({ day: day({ restDay: true }) }));
    expect(r.kind).toBe('no_feasible_plan');
    expect(reasonCodes(r)).toEqual(['REST_DAY']);
    expect(r.changes).toEqual([]);
  });

  it('no candidates is an answer, not an error', () => {
    const r = plan([]);
    expect(r).toEqual({ kind: 'no_feasible_plan', reasons: [], changes: [] });
  });

  it('every exercise out of bounds: the exercises go, the day is empty, and says why', () => {
    const ctx = context({
      eligibility: { profile: { knee: null }, excludedIds: new Set(['ex-e1', 'ex-e2']) },
    });
    const r = plan([exposure('e1'), exposure('e2')], ctx);
    expect(r.kind).toBe('no_feasible_plan');
    expect(reasonCodes(r)).toEqual(['USER_EXCLUDED', 'USER_EXCLUDED']);
    expect(changesOf(r)).toEqual([
      'drop_exposure:e1:USER_EXCLUDED',
      'drop_exposure:e2:USER_EXCLUDED',
    ]);
  });

  it('what is left after the ones that cannot be done is a shorter legal day', () => {
    const ctx = context({
      eligibility: { profile: { knee: null }, excludedIds: new Set(['ex-e1']) },
    });
    const r = plan([exposure('e1'), exposure('e2')], ctx);
    expect(r.kind).toBe('adjusted');
    expect(r.kind === 'adjusted' && r.plan.exposures.map((e) => e.id)).toEqual(['s1/r1/e2']);
  });

  it('what the engine cannot handle at all is said to be unsupported', () => {
    const odd = (key: string) =>
      exposure(key, { sets: [set({ resistance: { ...kg(4), modelId: 'barbell' } })] });
    const r = plan([odd('e1'), odd('e2')]);
    expect(r.kind).toBe('unsupported_input');
    expect(reasonCodes(r)).toEqual(['UNSUPPORTED_CAPABILITY', 'UNSUPPORTED_CAPABILITY']);
  });

  it('so is a plan the compiler cannot make into one that holds together', () => {
    const r = plan([exposure('e1', { sets: [set({ lo: 8, target: 6, hi: 4 })] })]);
    expect(r.kind).toBe('unsupported_input');
    expect(reasonCodes(r).every((c) => c === 'PLAN_INVALID')).toBe(true);
  });

  it('a mix of reasons is no plan, not unsupported', () => {
    const ctx = context({
      eligibility: { profile: { knee: null }, excludedIds: new Set(['ex-e1']) },
    });
    const odd = exposure('e2', { sets: [set({ resistance: { ...kg(4), modelId: 'barbell' } })] });
    expect(plan([exposure('e1'), odd], ctx).kind).toBe('no_feasible_plan');
  });
});

describe('T62 the limits of a muscle', () => {
  const two = catalogOf({}, {}, { primaryMuscles: ['back'] });

  it('a set goes from the exposure of that muscle with the most, then the exposure', () => {
    const ctx = context({ catalog: two, day: day({ dayMax: 3 }) });
    const r = plan(
      [
        exposure('e1', { sets: [set(), set()] }),
        exposure('e2', { sets: [set(), set()] }),
        exposure('e3'),
      ],
      ctx,
    );
    expect(changesOf(r)).toEqual(['reduce_sets:e2:DAY_MAX_EXCEEDED']);
    expect(r.kind === 'adjusted' && r.plan.exposures.map((e) => e.sets.length)).toEqual([2, 1, 2]);
  });

  it('when no set can be spared, the exercise goes', () => {
    const ctx = context({ catalog: two, day: day({ dayMax: 1 }) });
    const r = plan([exposure('e1', { sets: [set()] }), exposure('e2', { sets: [set()] })], ctx);
    expect(changesOf(r)).toEqual(['drop_exposure:e2:DAY_MAX_EXCEEDED']);
  });

  it('the week, counting the sets whose effort nobody gave', () => {
    const ctx = context({
      day: day({ week: { quads: { certain: 3, uncertain: 2 } }, weekMax: () => 6 }),
    });
    const r = plan([exposure('e1', { sets: [set(), set()] })], ctx);
    expect(changesOf(r)).toEqual(['reduce_sets:e1:WEEK_MAX_EXCEEDED']);
  });

  it('too many sets in an exposure: one goes at a time', () => {
    const many = exposure('e1', { sets: Array.from({ length: 8 }, () => set()) });
    const r = plan([many], context({ day: undefined }));
    expect(changesOf(r)).toEqual(['reduce_sets:e1:PLANNER_LIMIT', 'reduce_sets:e1:PLANNER_LIMIT']);
  });

  it('a range the planner does not keep to: the exercise goes', () => {
    const r = plan([exposure('e1', { sets: [set({ hi: 40 })] }), exposure('e2')]);
    expect(changesOf(r)).toEqual(['drop_exposure:e1:PLANNER_LIMIT']);
  });
});

describe('T69 advice the person confirmed is not mended', () => {
  it('the plan stands, with what was confirmed in its stamp', () => {
    const r = plan([exposure('e1')], withTime(100), { acknowledged: ['TIME_OVER_BUDGET'] });
    expect(r.kind).toBe('ready');
    if (r.kind !== 'ready') return;
    expect(r.plan.audit.overrides).toEqual(['TIME_OVER_BUDGET']);
    expect(r.notes.map((n) => n.code)).toEqual(['TIME_OVER_BUDGET']);
  });

  it('what was not confirmed still is', () => {
    const r = plan(
      [exposure('e1', { sets: [set()] }), exposure('e2', { sets: [set()] })],
      withTime(100),
      {
        acknowledged: ['DAY_MAX_EXCEEDED'],
      },
    );
    expect(changesOf(r)).toEqual(['drop_exposure:e2:TIME_OVER_BUDGET']);
  });
});

describe('the budget of steps', () => {
  it('is spent in steps, not seconds: when it runs out there is no plan, with what was tried', () => {
    const specs = [
      exposure('e1'),
      exposure('e2', { filler: true }),
      exposure('e3', { filler: true }),
    ];
    const r = plan(specs, withTime(260), { budget: 1 });
    expect(r.kind).toBe('no_feasible_plan');
    expect(changesOf(r)).toEqual(['drop_filler:e3:TIME_OVER_BUDGET']);
    expect(reasonCodes(r)).toEqual(['TIME_OVER_BUDGET']);
  });

  it('none at all: the plan is audited and nothing is changed', () => {
    const r = plan([exposure('e1', { filler: true })], withTime(100), { budget: 0 });
    expect(r.kind).toBe('no_feasible_plan');
    expect(r.changes).toEqual([]);
  });
});

describe('T56 the same input is the same plan', () => {
  it('twice, bit for bit', () => {
    const specs = [exposure('e1'), exposure('e2', { filler: true })];
    expect(plan(specs, withTime(200))).toEqual(plan(specs, withTime(200)));
  });
});
