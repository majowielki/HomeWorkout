/**
 * Engine v2, P4 (01 §5, 12 §2, T07, T48, T59, T62-T65, T69): one audit for every
 * plan, whichever way it came about.
 */
import { auditPlan, type AuditIssue, type AuditResult } from '../plan/audit';
import { stampPlan } from '../plan/compile';
import type { SessionPlanV2 } from '../plan/planV2';
import { CONSERVATIVE } from './fixtures';
import { CATALOG, catalogOf, context, day, exposure, kg, planOf, set } from './auditFixtures';
import { body, single } from './compileFixtures';

const codes = (result: AuditResult) =>
  (result.kind === 'invalid' ? result.issues : []).map((i) => i.code);
const noteCodes = (result: AuditResult) => result.notes.map((i) => i.code);
const issuesOf = (result: AuditResult): AuditIssue[] =>
  result.kind === 'invalid' ? result.issues : [];

describe('a plan that is fine', () => {
  const plan = planOf();

  it('is valid, with the hash it was stamped with, and nothing to say', () => {
    const result = auditPlan(plan, context());
    expect(result).toEqual({ kind: 'valid', planHash: plan.audit.planHash, notes: [] });
  });

  it('is not changed by the audit (it is pure)', () => {
    const frozen = JSON.parse(JSON.stringify(plan)) as SessionPlanV2;
    const deepFreeze = (o: unknown): void => {
      if (typeof o === 'object' && o !== null) {
        Object.values(o).forEach(deepFreeze);
        Object.freeze(o);
      }
    };
    deepFreeze(frozen);
    expect(auditPlan(frozen, context()).kind).toBe('valid');
  });

  it('says what is worth saying without failing: a first exposure, a supplemental one', () => {
    const first = exposure('e1', {
      trace: { ...exposure('e1').trace, code: 'FIRST_COMPARABLE_EXPOSURE' },
    });
    const result = auditPlan(planOf([first, exposure('e2', { scope: 'supplemental' })]), context());
    expect(result.kind).toBe('valid');
    expect(noteCodes(result)).toEqual(['CALIBRATION_FIRST', 'SUPPLEMENTAL_ONLY']);
  });
});

describe('T07 the same plan gets the same verdict from wherever it came', () => {
  const excluded = context({
    eligibility: { profile: { knee: null }, excludedIds: new Set(['ex-e1']) },
  });

  it.each(['engine', 'manual', 'ai_accepted', 'imported'] as const)('%s', (source) => {
    const result = auditPlan(planOf([exposure('e1')], { source }), excluded);
    expect(codes(result)).toEqual(['USER_EXCLUDED']);
  });

  it.each(['main', 'extra', 'template'] as const)('a %s session', (kind) => {
    expect(codes(auditPlan(planOf([exposure('e1')], { kind }), excluded))).toEqual([
      'USER_EXCLUDED',
    ]);
  });

  it('a rest day is a rest day for the engine’s own plans, not for one the person asked for', () => {
    const rest = context({ day: day({ restDay: true }) });
    expect(codes(auditPlan(planOf(), rest))).toEqual(['REST_DAY']);
    expect(auditPlan(planOf([exposure('e1')], { source: 'manual' }), rest).kind).toBe('valid');
  });
});

describe('what is wrong with the plan itself', () => {
  it('a plan the schema refuses stops there, with where and why', () => {
    const plan = planOf([exposure('e1')]);
    const broken = { ...plan, exposures: [plan.exposures[0]!, plan.exposures[0]!] };
    const result = auditPlan(broken, context());
    expect(result.kind).toBe('invalid');
    expect(codes(result).every((c) => c === 'PLAN_INVALID')).toBe(true);
    expect(issuesOf(result)[0]!.data).toMatchObject({ message: expect.any(String) });
  });

  it('a plan changed after it was audited is not the plan that was audited', () => {
    const plan = planOf();
    const changed = { ...plan, trainingDate: '2026-10-10' };
    expect(codes(auditPlan(changed, context()))).toEqual(['PLAN_INTEGRITY']);
    expect(auditPlan(changed, context({ mode: 'history_import' })).kind).toBe('valid');
    expect(auditPlan(changed, context({ mode: 'historical_display' })).kind).toBe('valid');
  });

  it('a recipe of progression with no set to judge it by', () => {
    const none = exposure('e1', { sets: [set({ required: false }), set({ required: false })] });
    expect(codes(auditPlan(planOf([none]), context()))).toEqual(['RECIPE_INCOMPLETE']);
    expect(auditPlan(planOf([exposure('e1', { ...none, scope: 'none' })]), context()).kind).toBe(
      'valid',
    );
  });

  it('a trace that does not agree with the policy, or with the registry of codes', () => {
    const base = exposure('e1');
    const wrongPolicy = { ...base.trace, policy: { id: 'other', version: '1' } };
    expect(codes(auditPlan(planOf([{ ...base, trace: wrongPolicy }]), context()))).toContain(
      'TRACE_INCONSISTENT',
    );
    const wrongCode = { ...base.trace, code: 'MADE_UP' };
    expect(codes(auditPlan(planOf([{ ...base, trace: wrongCode }]), context()))).toEqual([
      'TRACE_INCONSISTENT',
    ]);
  });

  it('a policy the engine does not have', () => {
    const other = exposure('e1', { policy: { id: 'gone', version: '1' } });
    other.trace = { ...other.trace, policy: { id: 'gone', version: '1' } };
    const result = auditPlan(planOf([other]), context());
    expect(codes(result)).toEqual(['UNSUPPORTED_CAPABILITY']);
    expect(issuesOf(result)[0]!.data).toMatchObject({ missing: 'UNKNOWN_POLICY' });
    const old = exposure('e1', { policy: { id: 'reps_then_resistance', version: '1' } });
    old.trace = { ...old.trace, policy: { id: 'reps_then_resistance', version: '1' } };
    expect(codes(auditPlan(planOf([old]), context()))).toEqual(['UNSUPPORTED_CAPABILITY']);
  });
});

describe('who may be planned', () => {
  it('an exercise the catalogue does not have, or has retired', () => {
    expect(codes(auditPlan(planOf(), context({ catalog: {} })))).toEqual(['NOT_IN_CATALOG']);
    const retired = catalogOf({ archived: true });
    expect(codes(auditPlan(planOf(), context({ catalog: retired })))).toEqual(['NOT_IN_CATALOG']);
  });

  it('equipment that is not in the room', () => {
    const catalog = catalogOf({ equipment: ['band'] });
    const room = {
      profile: { knee: null },
      excludedIds: new Set<string>(),
      equipment: ['dumbbell' as const],
    };
    expect(codes(auditPlan(planOf(), context({ catalog, eligibility: room })))).toEqual([
      'EQUIPMENT_UNAVAILABLE',
    ]);
  });

  it('what the knee does not allow', () => {
    const catalog = catalogOf({ loadsKnee: true, forceProfile: 'Plyometric' });
    const result = auditPlan(
      planOf(),
      context({ catalog, eligibility: { profile: CONSERVATIVE, excludedIds: new Set() } }),
    );
    expect(codes(result)).toEqual(['MEDICAL_EXCLUSION']);
    expect(issuesOf(result)[0]!.data).toMatchObject({ reason: 'KNEE_PLYOMETRIC' });
    expect(issuesOf(result)[0]!.repairs).toEqual(['drop_exposure']);
  });

  it('a hard finding is never passed by acknowledging it', () => {
    const excluded = context({
      eligibility: { profile: { knee: null }, excludedIds: new Set(['ex-e1']) },
    });
    expect(auditPlan(planOf(), excluded, ['USER_EXCLUDED']).kind).toBe('invalid');
  });
});

describe('the resistance of every set', () => {
  it('equipment the engine has no model for', () => {
    const odd = exposure('e1', { sets: [set({ resistance: { ...kg(4), modelId: 'barbell' } })] });
    const result = auditPlan(planOf([odd]), context());
    expect(codes(result)).toEqual(['UNSUPPORTED_CAPABILITY']);
    expect(issuesOf(result)[0]!.data).toMatchObject({ missing: 'UNKNOWN_MODEL' });
  });

  it('a value the model cannot make, or the equipment cannot reach (T43, T44)', () => {
    const between = exposure('e1', { sets: [set({ resistance: kg(5) })] });
    expect(codes(auditPlan(planOf([between]), context()))).toEqual(['RESISTANCE_UNREACHABLE']);
    const wrongKind = exposure('e1', {
      sets: [set({ resistance: { ...kg(4), value: { kind: 'ordinal', levelId: 'x' } } })],
    });
    expect(codes(auditPlan(planOf([wrongKind]), context()))).toEqual(['RESISTANCE_UNREACHABLE']);
  });

  it('a step up of more than one step from where the person last was', () => {
    const last = new Map([['ex-e1|dumbbell.paired|external_mass/per_hand/x2', kg(4)]]);
    const withLast = context({ day: day({ lastResistance: last }) });
    const two = exposure('e1', { sets: [set({ resistance: kg(8) })] });
    expect(codes(auditPlan(planOf([two]), withLast))).toEqual(['LOAD_JUMP_OVER_POLICY']);
    const one = exposure('e1', { sets: [set({ resistance: kg(6) })] });
    expect(auditPlan(planOf([one]), withLast).kind).toBe('valid');
    const down = exposure('e1', { sets: [set({ resistance: kg(2) })] });
    expect(auditPlan(planOf([down]), withLast).kind).toBe('valid');
  });

  it('a probe is the one step that is tried, but only one', () => {
    const last = new Map([['ex-e1|dumbbell.paired|external_mass/per_hand/x2', kg(4)]]);
    const withLast = context({ day: day({ lastResistance: last }) });
    const probe = exposure('e1', {
      sets: [
        set({ role: 'probe', required: false, resistance: kg(8) }),
        set({ resistance: kg(4) }),
      ],
    });
    expect(auditPlan(planOf([probe]), withLast).kind).toBe('valid');
  });

  it('what was last done on another model says nothing about the jump', () => {
    const last = new Map([['ex-e1|dumbbell.paired|external_mass/per_hand/x2', single(4)]]);
    const two = exposure('e1', { sets: [set({ resistance: kg(8) })] });
    expect(auditPlan(planOf([two]), context({ day: day({ lastResistance: last }) })).kind).toBe(
      'valid',
    );
  });

  it('a deload week does not go harder than the last exposure', () => {
    const last = new Map([['ex-e1|dumbbell.paired|external_mass/per_hand/x2', kg(4)]]);
    const deload = context({ day: day({ lastResistance: last, deload: true }) });
    const up = exposure('e1', { sets: [set({ resistance: kg(6) })] });
    expect(codes(auditPlan(planOf([up]), deload))).toEqual(['DELOAD_WORK_OVER_POLICY']);
    expect(auditPlan(planOf(), deload).kind).toBe('valid');
  });
});

describe('limits: the data’s are hard, the planner’s are advice', () => {
  const tall = (top: number) => exposure('e1', { sets: [set({ lo: 8, target: 10, hi: top })] });

  it('repetitions', () => {
    expect(codes(auditPlan(planOf([tall(40)]), context()))).toEqual(['PLANNER_LIMIT']);
    expect(codes(auditPlan(planOf([tall(120)]), context()))).toEqual(['TECHNICAL_LIMIT']);
    expect(auditPlan(planOf([tall(30)]), context()).kind).toBe('valid');
  });

  it('seconds', () => {
    const hold = (top: number) =>
      exposure('e1', {
        unit: 'duration',
        sets: [set({ resistance: body, lo: 20, target: 40, hi: top })],
      });
    expect(codes(auditPlan(planOf([hold(400)]), context()))).toEqual(['PLANNER_LIMIT']);
    expect(codes(auditPlan(planOf([hold(4000)]), context()))).toEqual(['TECHNICAL_LIMIT']);
    expect(auditPlan(planOf([hold(300)]), context()).kind).toBe('valid');
  });

  it('sets', () => {
    const many = (n: number) => exposure('e1', { sets: Array.from({ length: n }, () => set()) });
    expect(codes(auditPlan(planOf([many(7)]), context({ day: undefined })))).toEqual([
      'PLANNER_LIMIT',
    ]);
    expect(codes(auditPlan(planOf([many(11)]), context({ day: undefined })))).toEqual([
      'TECHNICAL_LIMIT',
    ]);
    expect(issuesOf(auditPlan(planOf([many(7)]), context({ day: undefined })))[0]!.repairs).toEqual(
      ['reduce_sets'],
    );
  });
});

describe('a measure no policy reads', () => {
  it('has no limit to be over, and is not mistaken for one', () => {
    const plan = planOf();
    const { audit: _audit, ...draft } = plan;
    const target = { kind: 'distance' as const, targetMeters: 5000 };
    const exposures = draft.exposures.map((e) => ({
      ...e,
      sets: e.sets.map((s) => ({ ...s, target })),
    }));
    const far = stampPlan(
      { ...draft, exposures },
      { mode: 'new_plan', snapshotFingerprint: plan.audit.snapshotFingerprint, overrides: [] },
    );
    expect(auditPlan(far, context()).kind).toBe('valid');
  });
});

describe('T62-T64 the day', () => {
  it('a muscle left out on request, hurting today, sore, still recovering', () => {
    const avoid = context({
      day: day({ avoided: { primary: new Set(['quads']), any: new Set(['quads']) } }),
    });
    expect(codes(auditPlan(planOf(), avoid))).toEqual(['AVOIDED_BY_REQUEST']);
    const pain = context({ day: day({ painMuscles: new Set(['quads']) }) });
    expect(codes(auditPlan(planOf(), pain))).toEqual(['PAIN_TODAY']);
    const sore = context({ day: day({ isSore: () => true }) });
    expect(codes(auditPlan(planOf(), sore))).toEqual(['DOMS_HIGH']);
    const recovering = context({ day: day({ isRecovering: () => true }) });
    expect(codes(auditPlan(planOf(), recovering))).toEqual(['RECOVERING']);
  });

  it('pain and a request are hard; being sore or recovering is advice that can be acknowledged (D19)', () => {
    const sore = context({ day: day({ isSore: () => true }) });
    const result = auditPlan(planOf(), sore, ['DOMS_HIGH']);
    expect(result.kind).toBe('valid');
    expect(noteCodes(result)).toEqual(['DOMS_HIGH']);
    const pain = context({ day: day({ painMuscles: new Set(['quads']) }) });
    expect(auditPlan(planOf(), pain, ['PAIN_TODAY']).kind).toBe('invalid');
  });

  it('T62 more sets for a muscle in a day than it may have, counting what it already got', () => {
    const result = auditPlan(
      planOf(),
      context({ day: day({ dayMax: 3, doneToday: { quads: 2 } }) }),
    );
    expect(codes(result)).toEqual(['DAY_MAX_EXCEEDED']);
    expect(issuesOf(result)[0]).toMatchObject({
      data: { muscle: 'quads', done: 2, planned: 2, after: 4, dayMax: 3 },
      repairs: ['reduce_sets', 'drop_exposure'],
    });
    expect(
      auditPlan(planOf(), context({ day: day({ dayMax: 3, doneToday: { quads: 1 } }) })).kind,
    ).toBe('valid');
  });

  it('T63 more in the week than it may have, counting the sets whose effort nobody gave', () => {
    const week = (certain: number, uncertain: number) =>
      context({ day: day({ week: { quads: { certain, uncertain } }, weekMax: () => 6 }) });
    expect(auditPlan(planOf(), week(4, 0)).kind).toBe('valid');
    const result = auditPlan(planOf(), week(3, 2));
    expect(codes(result)).toEqual(['WEEK_MAX_EXCEEDED']);
    expect(issuesOf(result)[0]!.data).toMatchObject({ certain: 3, uncertain: 2, weekMax: 6 });
  });

  it('a set done on each side is one set for the muscle, a warm-up or practice none', () => {
    const sided = exposure('e1', { sideMode: 'per_set', sets: [set(), set(), set()] });
    const ok = context({ day: day({ dayMax: 3 }) });
    expect(auditPlan(planOf([sided]), ok).kind).toBe('valid');
    const light = exposure('e1', {
      sets: [
        set({ role: 'warmup', required: false }),
        set({ role: 'practice', required: false, targetRir: { min: 5, max: 5 } }),
        set(),
        set(),
      ],
    });
    expect(auditPlan(planOf([light]), context({ day: day({ dayMax: 2 }) })).kind).toBe('valid');
    expect(codes(auditPlan(planOf([light]), context({ day: day({ dayMax: 1 }) })))).toEqual([
      'DAY_MAX_EXCEEDED',
    ]);
  });

  it('mobility is no hard work for a muscle', () => {
    const catalog = catalogOf({ movementPattern: 'Mobility' });
    const tight = context({ catalog, day: day({ dayMax: 1 }) });
    expect(auditPlan(planOf(), tight).kind).toBe('valid');
  });

  it('time over the budget, with what could be done about it', () => {
    const result = auditPlan(planOf(), context({ day: day({ sessionSecMax: 100 }) }));
    expect(codes(result)).toEqual(['TIME_OVER_BUDGET']);
    expect(issuesOf(result)[0]!.repairs).toEqual([
      'drop_filler',
      'split_superset',
      'reduce_sets',
      'drop_exposure',
    ]);
    expect(auditPlan(planOf(), context({ day: day({ sessionSecMax: null }) })).kind).toBe('valid');
  });

  it('with no day to judge by, only the plan and the exercises are', () => {
    expect(auditPlan(planOf(), context({ day: undefined })).kind).toBe('valid');
  });
});

describe('T46 the equipment held for one exercise and needed for another', () => {
  const pair = exposure('e1', {
    group: 'A',
    sets: [set({ resistance: kg(8) }), set({ resistance: kg(8) })],
  });
  const solo = exposure('e2', {
    group: 'A',
    comparisonKey: 'e2|dumbbell.single',
    sets: [set({ resistance: single(14) }), set({ resistance: single(14) })],
  });
  /** The plan as if nobody had planned the changeovers. */
  const unplanned = () => {
    const plan = planOf([pair, solo]);
    const { audit: _audit, ...draft } = plan;
    return stampPlan(
      { ...draft, execution: { steps: plan.execution.steps.filter((s) => s.kind !== 'setup') } },
      { mode: 'new_plan', snapshotFingerprint: plan.audit.snapshotFingerprint, overrides: [] },
    );
  };

  it('a changeover that is planned is fine; one that is not planned is a second pair that does not exist', () => {
    expect(auditPlan(planOf([pair, solo]), context()).kind).toBe('valid');
    const result = auditPlan(unplanned(), context());
    expect(codes(result)).toEqual(['RESOURCE_CONFLICT', 'RESOURCE_CONFLICT']);
    expect(issuesOf(result)[0]).toMatchObject({
      data: { resource: 'dumbbell-set', held: 'single:14000', needed: 'paired:8000' },
      repairs: ['split_superset'],
    });
  });

  it('an acknowledged conflict is a note, not a stop', () => {
    const result = auditPlan(unplanned(), context(), ['RESOURCE_CONFLICT']);
    expect(result.kind).toBe('valid');
    expect(noteCodes(result)).toEqual(['RESOURCE_CONFLICT', 'RESOURCE_CONFLICT']);
  });
});

describe('T69 advice the person was shown and confirmed', () => {
  const over = context({ day: day({ dayMax: 1, sessionSecMax: 100 }) });

  it('is a valid plan with the advice among the notes; unconfirmed advice is what stops it', () => {
    const stopped = auditPlan(planOf(), over);
    expect(codes(stopped)).toEqual(['DAY_MAX_EXCEEDED', 'TIME_OVER_BUDGET']);
    const half = auditPlan(planOf(), over, ['DAY_MAX_EXCEEDED']);
    expect(codes(half)).toEqual(['TIME_OVER_BUDGET']);
    expect(noteCodes(half)).toEqual(['DAY_MAX_EXCEEDED']);
    const all = auditPlan(planOf(), over, ['DAY_MAX_EXCEEDED', 'TIME_OVER_BUDGET']);
    expect(all.kind).toBe('valid');
    expect(noteCodes(all)).toEqual(['DAY_MAX_EXCEEDED', 'TIME_OVER_BUDGET']);
  });

  it('the hard findings come before the advice', () => {
    const both = context({
      eligibility: { profile: { knee: null }, excludedIds: new Set(['ex-e1']) },
      catalog: catalogOf({ archived: true }),
      day: day({ dayMax: 1 }),
    });
    expect(codes(auditPlan(planOf(), both))).toEqual([
      'NOT_IN_CATALOG',
      'USER_EXCLUDED',
      'DAY_MAX_EXCEEDED',
    ]);
  });

  it('is judged the same however the findings were found: the order is fixed', () => {
    const a = auditPlan(planOf([exposure('e1'), exposure('e2')]), over);
    const b = auditPlan(planOf([exposure('e2'), exposure('e1')]), over);
    expect(codes(a).sort()).toEqual(codes(b).sort());
    expect(issuesOf(a).map((i) => i.code)).toEqual([...issuesOf(a)].map((i) => i.code).sort());
  });
});

describe('T48, T59 what is left of a session', () => {
  const two = [exposure('e1'), exposure('e2')];

  it('looks only at the sets that are not done, and at exposures that still have one', () => {
    const plan = planOf(two);
    const settled = new Set(plan.exposures[0]!.sets.map((s) => s.id));
    const newlyExcluded = context({
      mode: 'resume_session',
      settled,
      eligibility: { profile: { knee: null }, excludedIds: new Set(['ex-e1', 'ex-e2']) },
    });
    const result = auditPlan(plan, newlyExcluded);
    expect(issuesOf(result).map((i) => i.scope.exposureId)).toEqual(['s1/r1/e2']);
  });

  it('does not count the sets that were done against the limit of the day a second time', () => {
    const plan = planOf([exposure('e1')]);
    const settled = new Set([plan.exposures[0]!.sets[0]!.id]);
    const resumed = context({
      mode: 'resume_session',
      settled,
      day: day({ dayMax: 1, doneToday: { quads: 0 } }),
    });
    expect(auditPlan(plan, resumed).kind).toBe('valid');
    const twice = context({
      mode: 'resume_session',
      settled,
      day: day({ dayMax: 1, doneToday: { quads: 1 } }),
    });
    expect(codes(auditPlan(plan, twice))).toEqual(['DAY_MAX_EXCEEDED']);
  });

  it('a session started is judged afresh', () => {
    const excluded = context({
      mode: 'start_session',
      eligibility: { profile: { knee: null }, excludedIds: new Set(['ex-e1']) },
    });
    expect(codes(auditPlan(planOf(), excluded))).toEqual(['USER_EXCLUDED']);
  });
});

describe('T55 a plan that is only kept or shown', () => {
  it('is not judged by today’s rules, and still has to hold together', () => {
    const excluded = context({
      mode: 'history_import',
      eligibility: { profile: { knee: null }, excludedIds: new Set(['ex-e1']) },
      day: day({ restDay: true, dayMax: 0 }),
    });
    expect(auditPlan(planOf(), excluded).kind).toBe('valid');
    expect(auditPlan(planOf(), { ...excluded, mode: 'historical_display' }).kind).toBe('valid');
    const plan = planOf();
    const broken = { ...plan, exposures: [] };
    expect(auditPlan(broken, excluded).kind).toBe('invalid');
  });
});

describe('the catalogue the audit is run against', () => {
  it('has the exercises the fixtures plan', () => {
    expect(Object.keys(CATALOG)).toEqual(['ex-e1', 'ex-e2', 'ex-e3']);
  });
});
