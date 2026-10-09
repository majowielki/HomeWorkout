import { assessSessionChange } from '../session/assess';
import type { SessionChange } from '../session/types';
import { sessionPlanV2Schema } from '../plan/planV2';
import { auditPlan } from '../plan/audit';
import { modelFor, resistanceOf } from '../plan/resistanceOf';
import { adviceToAcknowledge } from '../policy/hardAdvice';
import { recipe, world, perform } from './sessionChangeFixtures';
import { CATALOG, SLOTS } from './dayV2Fixtures';
import { stampPlan, compilePlannedSets } from '../plan/compile';
import { exposureOf, body, kg } from './progressionFixtures';
import { revisePending, revisionBase, setOrder, settledSets } from '../session/revision';
import { DEFAULT_MODEL_CONTEXT } from '../resistance/registry';
import { changeEffects, remainingVolume, assessmentDay } from '../session/effects';

const add = (id = 'crunch', sets?: number): SessionChange => ({
  kind: 'add_exercise',
  exercise: { id },
  ...(sets === undefined ? {} : { sets }),
});
const codes = (a: ReturnType<typeof assessSessionChange>) => a.checks.map((c) => c.code);

describe('P4b.2 T61-T66', () => {
  it('T61 prescribes the requested active exercise with an audited, concrete patch', () => {
    const { snap, session } = world();
    const a = assessSessionChange(snap, session, add());
    expect(a.verdict).toBe('ok');
    expect(a.prescription?.exerciseId).toBe('crunch');
    expect(a.prescription?.sets).toBe(a.recommendation?.sets.recommended);
    expect(a.patch?.basePlanRevision).toBe(1);
    expect(a.patch?.plan.planRevision).toBe(2);
    expect(sessionPlanV2Schema.safeParse(a.patch?.plan).success).toBe(true);
    expect(a.patch?.plan.audit.mode).toBe('resume_session');
    expect(codes(a)).toContain('CALIBRATION_FIRST');
  });

  it('T62 keeps the explicit count above day limits and explains done/after/dayMax', () => {
    const { snap, session } = world([recipe('crunch', 2)]);
    session.records = perform(session);
    const a = assessSessionChange(snap, session, add('crunch', 2));
    expect(a.verdict).toBe('not_recommended');
    expect(a.checks).toContainEqual(
      expect.objectContaining({
        code: 'DAY_MAX_EXCEEDED',
        data: expect.objectContaining({ done: 2, after: 4, dayMax: 3 }),
      }),
    );
    expect(a.prescription?.sets).toBe(2);
    expect(a.effects.progressionScope).toBe('supplemental');
    expect(a.effects.musclesToday.core).toMatchObject({ done: 2, remainingPlanned: 2, after: 4 });
    expect(a.patch).not.toBeNull();
  });

  it('T63 uncertain history consumes the upper weekly budget', () => {
    const { snap, session } = world();
    snap.records = [
      exposureOf({
        date: '2026-10-01',
        exerciseId: 'crunch',
        spec: body,
        sets: Array.from({ length: 6 }, () => ({ amount: 10, rir: null })),
      }),
    ];
    const a = assessSessionChange(snap, session, add('crunch', 1));
    expect(a.verdict).toBe('not_recommended');
    expect(a.checks).toContainEqual(
      expect.objectContaining({
        code: 'WEEK_MAX_EXCEEDED',
        data: expect.objectContaining({ certain: 0, uncertain: 6, planned: 1 }),
      }),
    );
    expect(a.effects.musclesWeek.core).toMatchObject({ certain: 0, uncertain: 6, after: 7 });
    expect(a.patch).not.toBeNull();
  });

  it.each(['constraint', 'shortfall'] as const)(
    'T64 pain from %s blocks work including secondary muscles',
    (source) => {
      const { snap, session } = world([recipe('crunch')]);
      if (source === 'constraint')
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
      else {
        session.records = perform(session, 1);
        session.records[0]!.sets[0]!.observation!.shortfall = 'pain';
      }
      const a = assessSessionChange(snap, session, add('db-romanian-deadlift', 1));
      expect(a.verdict).toBe('blocked');
      expect(codes(a)).toContain(source === 'constraint' ? 'AVOIDED_BY_REQUEST' : 'PAIN_TODAY');
      expect(a.patch).toBeNull();
    },
  );

  it('T65 recompiles plate changeovers and returns setup time as a resource warning', () => {
    const low = recipe('db-floor-press', 2, { group: 'A' });
    const high = recipe('db-romanian-deadlift', 2, { group: 'A' });
    const { snap, session } = world([low, high]);
    const a = assessSessionChange(snap, session, add('crunch', 1));
    expect(a.patch).not.toBeNull();
    expect(a.patch!.plan.time.setup).toBeGreaterThan(0);
    expect(a.checks).toContainEqual(
      expect.objectContaining({
        code: 'RESOURCE_CONFLICT',
        status: 'warn',
        data: expect.objectContaining({ setupSec: expect.any(Number) }),
      }),
    );
  });

  it('T66 only newly invalidated tomorrow slots are reported, without creating actual', () => {
    const { snap, session } = world();
    snap.tomorrow = {
      date: '2026-10-06',
      blockIndex: 1,
      phase: 'work',
      items: [
        {
          slotId: 'core-front',
          exerciseId: snap.block.selections['core-front']!,
          sets: 2,
          role: 'work',
        },
      ],
      skipped: [],
      dayReasons: [],
    };
    const untouched = JSON.stringify({ snap, session });
    const a = assessSessionChange(snap, session, add('crunch', 1));
    expect(a.effects.tomorrow).toMatchObject({
      date: '2026-10-06',
      changedSlots: ['core-front'],
      reasons: ['RECOVERING'],
    });
    expect(codes(a)).toContain('HURTS_TOMORROW');
    expect(a.verdict).toBe('ok_with_changes');
    expect(JSON.stringify({ snap, session })).toBe(untouched);
  });
});

describe('pending revisions and immutable results', () => {
  it.each(['swap_remaining', 'skip_remaining', 'reduce_remaining'] as const)(
    '%s keeps done ids, recipes and observations',
    (kind) => {
      const { snap, session } = world([recipe('crunch', 3)]);
      session.records = perform(session, 1);
      const done = session.plan.exposures[0]!.sets[0]!;
      const actual = JSON.stringify(session.records);
      const a = assessSessionChange(
        snap,
        session,
        kind === 'swap_remaining'
          ? { kind, exposureId: session.plan.exposures[0]!.id, exercise: { id: 'dead-bug' } }
          : { kind, exposureId: session.plan.exposures[0]!.id },
      );
      expect(a.patch).not.toBeNull();
      expect(a.patch!.plan.exposures.flatMap((e) => e.sets)).toContainEqual(done);
      expect(JSON.stringify(session.records)).toBe(actual);
      expect(sessionPlanV2Schema.safeParse(a.patch!.plan).success).toBe(true);
    },
  );

  it('append sets keep the exposure id and add ordinals from the new revision', () => {
    const { snap, session } = world([recipe('crunch', 2)]);
    session.records = perform(session);
    const a = assessSessionChange(snap, session, {
      kind: 'add_sets',
      exposureId: session.plan.exposures[0]!.id,
      sets: 1,
    });
    expect(a.patch).not.toBeNull();
    expect(a.patch!.plan.exposures[0]!.id).toBe(session.plan.exposures[0]!.id);
    const set = a.patch!.plan.exposures[0]!.sets.at(-1)!;
    expect(set.id).toBe('s1/r2/crunch/3');
    expect(set.requiredForProgression).toBe(false);
    expect(codes(a)).toContain('SUPPLEMENTAL_ONLY');
    expect(sessionPlanV2Schema.safeParse(a.patch!.plan).success).toBe(true);
  });

  it('reducing a unilateral exercise drops whole pending pairs and keeps the unperformed partner of a done side', () => {
    const { snap, session } = world([recipe('one-arm-db-row', 3, { sideMode: 'per_set' })]);
    session.records = perform(session, 1);
    const a = assessSessionChange(snap, session, {
      kind: 'reduce_remaining',
      exposureId: session.plan.exposures[0]!.id,
      dropSets: 2,
    });
    expect(a.patch?.plan.exposures[0]!.sets).toEqual(session.plan.exposures[0]!.sets.slice(0, 2));
    const invalid = assessSessionChange(snap, session, {
      kind: 'reduce_remaining',
      exposureId: session.plan.exposures[0]!.id,
      dropSets: 3,
    });
    expect(invalid.verdict).toBe('blocked');
  });

  it.each(['next', 'end'] as const)('inserts at %s while keeping other pending ids', (position) => {
    const { snap, session } = world([recipe('crunch', 2)]);
    const a = assessSessionChange(snap, session, {
      kind: 'add_exercise',
      exercise: { id: 'standing-calf-raise' },
      sets: 1,
      position,
    });
    expect(a.patch).not.toBeNull();
    const order = setOrder(a.patch!.plan);
    const newId = a.patch!.plan.exposures.at(-1)!.sets[0]!.id;
    expect(position === 'next' ? order[0] : order.at(-1)).toBe(newId);
    expect(a.patch!.plan.exposures[0]!.sets).toEqual(session.plan.exposures[0]!.sets);
  });

  it('skips are settled too: they are excluded from the future audit and volume', () => {
    const { snap, session } = world([recipe('crunch', 2)]);
    session.records[0]!.sets[0]!.disposition = 'skipped';
    const a = assessSessionChange(snap, session, {
      kind: 'skip_remaining',
      exposureId: session.plan.exposures[0]!.id,
    });
    expect(a.patch!.plan.exposures[0]!.sets).toHaveLength(1);
    expect(a.effects.musclesToday.core?.after).toBe(0);
    expect(a.effects.time.maxSec).toBe(1800);
  });
  it('attempted sets have an elapsed estimate, while skipped sets do not spend the time budget', () => {
    const { snap, session } = world([recipe('crunch')]);
    session.records = perform(session, 1);
    session.records[0]!.sets[0]!.disposition = 'interrupted';
    session.records[0]!.sets[0]!.observation!.status = 'interrupted';
    const a = assessSessionChange(snap, session, add('standing-calf-raise', 1));
    expect(a.effects.time.maxSec).toBeLessThan(1800);
    expect(a.effects.musclesToday.core?.done).toBe(0);
  });

  it('lowers only pending resistance to a reachable step', () => {
    const { snap, session } = world([recipe('db-floor-press', 3)]);
    session.records = perform(session, 1);
    const a = assessSessionChange(snap, session, {
      kind: 'reduce_remaining',
      exposureId: session.plan.exposures[0]!.id,
      easier: true,
    });
    expect(a.patch).not.toBeNull();
    const replacement = a.patch!.plan.exposures.at(-1)!;
    expect(replacement.sets).toHaveLength(2);
    expect(replacement.sets[0]!.resistance.value).toMatchObject({ massGrams: 2000 });
    expect(replacement.sets[0]!.comparisonGroupId).toBe(`${replacement.id}/work`);
    expect(sessionPlanV2Schema.safeParse(a.patch!.plan).success).toBe(true);
  });
});

describe('clarification, limits, state and audit agreement', () => {
  it('ambiguous exercise gives clarification and no patch', () => {
    const { snap, session } = world();
    const a = assessSessionChange(snap, session, {
      kind: 'add_exercise',
      exercise: { query: 'wyciskanie hantli nad głowę' },
    });
    expect(a.verdict).toBe('needs_clarification');
    expect(a.patch).toBeNull();
  });
  it('unrecognized exercise is blocked', () => {
    const { snap, session } = world();
    const a = assessSessionChange(snap, session, add('unknown'));
    expect(codes(a)).toContain('NOT_IN_CATALOG');
    expect(a.patch).toBeNull();
  });
  it.each([0, -1, 11, 1.5, NaN, Infinity])(
    'a malformed count %s is blocked, not normalized',
    (n) => {
      const { snap, session } = world();
      expect(assessSessionChange(snap, session, add('crunch', n)).verdict).toBe('blocked');
    },
  );
  it('same inputs give the identical assessment, patch and ids', () => {
    const { snap, session } = world([recipe('crunch')]);
    expect(assessSessionChange(snap, session, add('standing-calf-raise', 1))).toEqual(
      assessSessionChange(snap, session, add('standing-calf-raise', 1)),
    );
  });
  it('changes to actual and input revisions invalidate the deterministic assessment id', () => {
    const { snap, session } = world([recipe('crunch')]);
    const first = assessSessionChange(snap, session, add()).assessmentId;
    session.records = perform(session, 1);
    expect(assessSessionChange(snap, session, add()).assessmentId).not.toBe(first);
    snap.prefsRevision += 1;
    expect(assessSessionChange(snap, session, add()).assessmentId).not.toBe(first);
  });
  it('the resume audit still rejects advice until it is acknowledged', () => {
    const { snap, session } = world();
    const a = assessSessionChange(snap, session, add('crunch', 5));
    expect(a.verdict).toBe('not_recommended');
    const ctx = {
      mode: 'resume_session' as const,
      catalog: CATALOG,
      eligibility: snap.eligibility,
      modelOf: (s: Parameters<typeof modelFor>[0]) => modelFor(s),
      day: {
        date: snap.asOf,
        restDay: false,
        avoided: { primary: new Set<never>(), any: new Set<never>() },
        painMuscles: new Set<never>(),
        isSore: () => false,
        isRecovering: () => false,
        doneToday: {},
        week: {},
        dayMax: 3,
        weekMax: () => 6,
        sessionSecMax: null,
        lastResistance: new Map(),
        deload: false,
      },
    };
    expect(auditPlan(a.patch!.plan, ctx).kind).toBe('invalid');
    expect(auditPlan(a.patch!.plan, ctx, adviceToAcknowledge(a.checks)).kind).toBe('valid');
  });
  it('supplemental today and prior sessions count once, replacing stale active snapshot records', () => {
    const { snap, session } = world([recipe('crunch', 1)]);
    session.records = perform(session);
    snap.records = [
      ...session.records,
      exposureOf({
        date: snap.asOf,
        spec: body,
        exerciseId: 'crunch',
        sets: [10],
        scope: 'supplemental',
      }),
    ];
    const a = assessSessionChange(snap, session, add('crunch', 1));
    expect(a.effects.musclesToday.core?.done).toBe(2);
    expect(a.effects.musclesToday.core?.after).toBe(3);
  });
});

describe('edge cases of a concrete session change', () => {
  it.each(['swap_remaining', 'skip_remaining', 'add_sets', 'reduce_remaining'] as const)(
    'unknown exposure for %s is a hard failure',
    (kind) => {
      const { snap, session } = world();
      const change =
        kind === 'swap_remaining'
          ? { kind, exposureId: 'missing', exercise: { id: 'crunch' } }
          : kind === 'add_sets'
            ? { kind, exposureId: 'missing', sets: 1 }
            : { kind, exposureId: 'missing' };
      expect(assessSessionChange(snap, session, change).verdict).toBe('blocked');
    },
  );
  it.each(['skip_remaining', 'swap_remaining', 'reduce_remaining'] as const)(
    '%s cannot change a fully settled exposure',
    (kind) => {
      const { snap, session } = world([recipe('crunch')]);
      session.records = perform(session);
      const exposureId = session.plan.exposures[0]!.id;
      const a = assessSessionChange(
        snap,
        session,
        kind === 'swap_remaining'
          ? { kind, exposureId, exercise: { id: 'dead-bug' } }
          : { kind, exposureId },
      );
      expect(a.verdict).toBe('blocked');
    },
  );
  it('rejects dates outside the active training day', () => {
    const { snap, session } = world();
    snap.asOf = '2026-10-06';
    expect(assessSessionChange(snap, session, add()).verdict).toBe('blocked');
  });
  it('rejects a stored plan whose audited content changed before assessment', () => {
    const { snap, session } = world([recipe('crunch')]);
    session.plan.trainingDate = '2026-10-04';
    expect(codes(assessSessionChange(snap, session, add()))).toContain('PLAN_INTEGRITY');
  });
  it('rejects schema errors rather than silently re-stamping them', () => {
    const { snap, session } = world([recipe('crunch')]);
    session.plan.exposures.push(session.plan.exposures[0]!);
    expect(codes(assessSessionChange(snap, session, add()))).toContain('PLAN_INVALID');
  });
  it('distance recipes are explicitly unsupported by this runner', () => {
    const { snap, session } = world([recipe('crunch')]);
    session.plan.exposures[0]!.sets[0]!.target = { kind: 'distance', targetMeters: 200 };
    const { audit: _audit, ...draft } = session.plan;
    session.plan = stampPlan(draft, {
      mode: 'new_plan',
      snapshotFingerprint: snap.session.snapshotFingerprint,
      overrides: [],
    });
    expect(codes(assessSessionChange(snap, session, add()))).toContain('UNSUPPORTED_CAPABILITY');
  });
  it.each([0, 11])('cannot append %s sets', (sets) => {
    const { snap, session } = world([recipe('crunch')]);
    expect(
      assessSessionChange(snap, session, {
        kind: 'add_sets',
        exposureId: session.plan.exposures[0]!.id,
        sets,
      }).verdict,
    ).toBe('blocked');
  });
  it('technical maximum is for the entire exposure including completed sets', () => {
    const { snap, session } = world([recipe('crunch', 10)]);
    expect(
      assessSessionChange(snap, session, {
        kind: 'add_sets',
        exposureId: session.plan.exposures[0]!.id,
        sets: 1,
      }).verdict,
    ).toBe('blocked');
  });
  it.each([0, -1, 1.5, 11])('cannot drop %s pending sets', (dropSets) => {
    const { snap, session } = world([recipe('crunch')]);
    expect(
      assessSessionChange(snap, session, {
        kind: 'reduce_remaining',
        exposureId: session.plan.exposures[0]!.id,
        dropSets,
      }).verdict,
    ).toBe('blocked');
  });
  it('lowering a minimum bodyweight resistance cannot invent a lighter level', () => {
    const { snap, session } = world([recipe('crunch')]);
    expect(
      codes(
        assessSessionChange(snap, session, {
          kind: 'reduce_remaining',
          exposureId: session.plan.exposures[0]!.id,
          easier: true,
        }),
      ),
    ).toContain('RESISTANCE_UNREACHABLE');
  });
  it('can lower a unilateral exercise before any set has been performed', () => {
    const { snap, session } = world([recipe('one-arm-db-row', 2, { sideMode: 'per_set' })]);
    const a = assessSessionChange(snap, session, {
      kind: 'reduce_remaining',
      exposureId: session.plan.exposures[0]!.id,
      easier: true,
      dropSets: 1,
    });
    expect(a.patch).not.toBeNull();
    expect(a.effects.progressionScope).toBe('primary');
    expect(a.prescription?.sets).toBe(1);
  });
  it('can drop all sets with an easier request, without manufacturing another exposure', () => {
    const { snap, session } = world([recipe('crunch')]);
    const a = assessSessionChange(snap, session, {
      kind: 'reduce_remaining',
      exposureId: session.plan.exposures[0]!.id,
      dropSets: 2,
      easier: true,
    });
    expect(a.patch?.plan.exposures).toHaveLength(0);
  });
  it('unilateral appended sets keep their side suffixes and count as one direct logical set', () => {
    const { snap, session } = world([recipe('one-arm-db-row', 1, { sideMode: 'per_set' })]);
    const a = assessSessionChange(snap, session, {
      kind: 'add_sets',
      exposureId: session.plan.exposures[0]!.id,
      sets: 1,
    });
    expect(a.patch?.plan.exposures[0]!.sets.slice(-2).map((s) => s.id)).toEqual([
      's1/r2/one-arm-db-row/2L',
      's1/r2/one-arm-db-row/2R',
    ]);
  });
  it.each(['excluded', 'equipment', 'medical', 'archived'] as const)(
    'eligibility %s is decided by the same hard audit',
    (reason) => {
      const { snap, session } = world();
      const id = reason === 'medical' ? 'lateral-lunge' : 'db-floor-press';
      if (reason === 'excluded')
        snap.eligibility = { ...snap.eligibility, excludedIds: new Set([id]) };
      if (reason === 'equipment') snap.eligibility = { ...snap.eligibility, equipment: [] };
      if (reason === 'archived')
        snap.catalog = { ...snap.catalog, [id]: { ...snap.catalog[id]!, archived: true } };
      const a = assessSessionChange(snap, session, add(id, 1));
      expect(a.verdict).toBe('blocked');
      expect(a.patch).toBeNull();
    },
  );
  it('an exercise without an authored slot recipe is blocked', () => {
    const { snap, session } = world();
    snap.slots = [];
    expect(codes(assessSessionChange(snap, session, add()))).toContain('RECIPE_INCOMPLETE');
  });
  it('an unsupported resistance model is blocked instead of receiving an invented prescription', () => {
    const { snap, session } = world();
    snap.models = DEFAULT_MODEL_CONTEXT;
    snap.catalog = {
      ...snap.catalog,
      'band-chest-press': {
        ...snap.catalog['band-chest-press']!,
        movementPattern: 'Nowhere' as never,
      },
    };
    expect(codes(assessSessionChange(snap, session, add('band-chest-press')))).toContain(
      'UNSUPPORTED_CAPABILITY',
    );
  });
  it('an unavailable starting load is blocked without inventing a reachable step', () => {
    const { snap, session } = world();
    snap.models = { ...DEFAULT_MODEL_CONTEXT, dumbbells: { bars: 2, barMassKg: 2, plates: [] } };
    const a = assessSessionChange(snap, session, add('db-floor-press', 1));
    expect(a.verdict).toBe('blocked');
    expect(codes(a)).toContain('RESISTANCE_UNREACHABLE');
    expect(a.patch).toBeNull();
  });
  it('a non-rep exercise is prescribed with duration targets', () => {
    const { snap, session } = world();
    const a = assessSessionChange(snap, session, add('plank', 1));
    expect(a.prescription?.perSet[0]?.target.kind).toBe('duration');
    expect(sessionPlanV2Schema.safeParse(a.patch?.plan).success).toBe(true);
  });
  it('mobility uses a mobility recipe and never becomes primary progression evidence or overlapping hard work', () => {
    const { snap, session } = world([recipe('db-romanian-deadlift', 3)]);
    session.records = perform(session);
    const a = assessSessionChange(snap, session, add('cat-cow', 1));
    expect(a.effects.progressionScope).toBe('none');
    expect(a.patch?.plan.exposures.at(-1)?.sets[0]?.role).toBe('mobility');
    expect(a.patch?.plan.exposures.at(-1)?.sets[0]?.requiredForProgression).toBe(false);
    const rir = SLOTS.find((s) => s.exerciseIds.includes('cat-cow'))!.rir;
    expect(a.prescription?.perSet[0]?.targetRir).toEqual({ min: rir[0], max: rir[1] });
    expect(codes(a)).not.toContain('OVERLAP_TODAY');
  });
  it('a missing range uses the domain fallback', () => {
    const { snap, session } = world();
    snap.slots = SLOTS.map((s) => (s.id === 'core-front' ? { ...s, repRange: undefined } : s));
    expect(
      assessSessionChange(snap, session, add('crunch', 1)).prescription?.perSet[0]?.target,
    ).toMatchObject({ min: 8, max: 15 });
  });
  it('a request in deload keeps its count and explains the smaller recommendation', () => {
    const { snap, session } = world();
    snap.block = { ...snap.block, deloadFrom: snap.asOf, deloadReason: 'DELOAD_SCHEDULED' };
    const a = assessSessionChange(snap, session, add('crunch', 3));
    expect(a.prescription?.sets).toBe(3);
    expect(codes(a)).toContain('DELOAD_WORK_OVER_POLICY');
    expect(a.patch).not.toBeNull();
  });
  it('remaining time over budget is advice with seconds and a patch', () => {
    const slow = recipe('crunch');
    slow.sets = slow.sets.map((s) => ({ ...s, restAfterSec: 2000 }));
    const { snap, session } = world([slow]);
    const a = assessSessionChange(snap, session, add('standing-calf-raise', 1));
    expect(a.verdict).toBe('not_recommended');
    expect(codes(a)).toContain('TIME_OVER_BUDGET');
    expect(a.effects.time.remainingAfterSec).toBeGreaterThan(a.effects.time.maxSec);
    expect(a.patch).not.toBeNull();
  });
  it('DOMS and recovery remain advice, with the actual dates and soreness values', () => {
    const { snap, session } = world();
    snap.records = [
      exposureOf({ date: '2026-10-04', exerciseId: 'crunch', spec: body, sets: [10] }),
    ];
    snap.daily = [{ date: snap.asOf, sleepHours: 7, energy: 3, soreness: { core: 4 } }];
    const a = assessSessionChange(snap, session, add('crunch', 1));
    expect(a.verdict).toBe('not_recommended');
    expect(codes(a)).toEqual(expect.arrayContaining(['DOMS_HIGH', 'RECOVERING']));
    expect(a.effects.recovery.core).toMatchObject({
      lastPrimaryDate: '2026-10-04',
      daysAgo: 1,
      soreness: 4,
    });
  });
  it.each([
    { sleepHours: 5, energy: 3 },
    { sleepHours: null, energy: 2 },
  ])('new prescriptions use the shared readiness adjustment %j', (readiness) => {
    const { snap, session } = world();
    snap.daily = [{ date: snap.asOf, soreness: null, ...readiness }];
    expect(
      assessSessionChange(snap, session, add('crunch', 1)).prescription?.perSet[0]?.targetRir,
    ).toEqual({ min: 5, max: 5 });
  });
  it('history without performed sets supplies no resistance comparison', () => {
    const { snap, session } = world();
    snap.records = [
      exposureOf({ date: '2026-10-01', exerciseId: 'crunch', spec: body, sets: [null] }),
    ];
    expect(assessSessionChange(snap, session, add()).patch).not.toBeNull();
  });
  it('partial or unknown historical resistance does not create a load comparison', () => {
    const { snap, session } = world();
    const r = exposureOf({ date: '2026-10-01', exerciseId: 'crunch', spec: body, sets: [10] });
    r.sets[0]!.planned.resistance = { ...body, modelId: 'unknown' };
    snap.records = [r];
    expect(assessSessionChange(snap, session, add()).patch).not.toBeNull();
    r.sets[0]!.planned.resistance = body;
    r.sets[0]!.observation!.resistance.value = null;
    expect(assessSessionChange(snap, session, add()).patch).not.toBeNull();
  });
});

describe('the explicit-order compiler and pending reducer', () => {
  it('refuses a distance set and an unknown set id', () => {
    const { session } = world([recipe('crunch')]);
    const base = revisionBase(session.plan, modelFor);
    expect(() => compilePlannedSets(base, session.plan.exposures, ['unknown'])).toThrow(
      'Unknown planned set',
    );
    session.plan.exposures[0]!.sets[0]!.target = { kind: 'distance', targetMeters: 1 };
    expect(() => compilePlannedSets(base, session.plan.exposures, setOrder(session.plan))).toThrow(
      'Distance execution',
    );
  });
  it('counts both sides inside one set and preserves the explicit custom timing', () => {
    const { session } = world([recipe('crunch')]);
    session.plan.exposures[0]!.sets[0]!.target = {
      kind: 'reps',
      min: 8,
      target: 10,
      max: 15,
      count: 'per_side',
    };
    const base = {
      ...revisionBase(session.plan, modelFor),
      timing: { secondsPerRep: 3, changeoverSec: 10, bandWarmupSec: 20, setupSec: 5 },
    };
    const draft = compilePlannedSets(base, session.plan.exposures, setOrder(session.plan));
    expect(draft.time.hardWork).toBe(90);
  });
  it('the reducer refuses attempts to remove a completed set', () => {
    const { session } = world([recipe('crunch')]);
    session.records = perform(session, 1);
    expect(settledSets(session).size).toBe(1);
    expect(() =>
      revisePending(
        session,
        [
          {
            kind: 'dropSets',
            exposureId: session.plan.exposures[0]!.id,
            setIds: [session.plan.exposures[0]!.sets[0]!.id],
          },
        ],
        revisionBase(session.plan, modelFor),
      ),
    ).toThrow('Cannot revise settled sets');
  });
  it('preserves completed transitions, cues, rests and setup steps, and their time', () => {
    const { session } = world([recipe('band-chest-press', 2)]);
    session.records = perform(session, 1);
    const firstPerform = session.plan.execution.steps.findIndex((s) => s.kind === 'perform');
    const historical = session.plan.execution.steps.slice(0, firstPerform + 2);
    const a = revisePending(session, [], revisionBase(session.plan, modelFor));
    for (const step of historical) expect(a.plan.execution.steps).toContainEqual(step);
    expect(a.plan.time.warmup).toBe(session.plan.time.warmup);
    expect(sessionPlanV2Schema.safeParse(a.plan).success).toBe(true);
  });
});

describe('history, projection and recommendation boundaries', () => {
  it('supplemental work from only extra observations reserves the primary key and counts once', () => {
    const { snap, session } = world();
    const { session: logged } = world([recipe('crunch', 1)]);
    const r = perform(logged)[0]!;
    r.sessionId = 'other';
    r.extra = [r.sets[0]!.observation!, { ...r.sets[0]!.observation!, status: 'interrupted' }];
    r.sets = [];
    snap.records = [r];
    const a = assessSessionChange(snap, session, add('crunch', 1));
    expect(a.effects.progressionScope).toBe('supplemental');
    expect(a.effects.musclesToday.core?.done).toBe(1);
  });
  it('swapping to the same key without actual preserves a single primary exposure', () => {
    const { snap, session } = world([recipe('crunch')]);
    const a = assessSessionChange(snap, session, {
      kind: 'swap_remaining',
      exposureId: session.plan.exposures[0]!.id,
      exercise: { id: 'crunch' },
    });
    expect(a.effects.progressionScope).toBe('primary');
    expect(a.patch?.plan.exposures).toHaveLength(1);
  });
  it('no room gives an honest zero recommendation and an explicit default proposal with advice', () => {
    const { snap, session } = world([recipe('crunch', 3)]);
    const a = assessSessionChange(snap, session, add('crunch'));
    expect(a.recommendation?.sets.recommended).toBe(0);
    expect(a.prescription?.sets).toBeGreaterThan(0);
    expect(a.verdict).toBe('not_recommended');
    expect(a.patch).not.toBeNull();
  });
  it('prescriptions preserve a probe inside the explicit total count, including repeated backoff targets', () => {
    const { snap, session } = world();
    const key = resistanceOf(
      CATALOG['db-floor-press']!,
      SLOTS.find((s) => s.id === 'push-horizontal')!,
    )!.comparisonKey;
    snap.records = ['2026-09-29', '2026-10-01'].map((date) =>
      exposureOf({
        date,
        exerciseId: 'db-floor-press',
        spec: kg(4),
        range: { lo: 8, hi: 15 },
        sets: [15, 15],
        key,
      }),
    );
    const a = assessSessionChange(snap, session, add('db-floor-press', 3));
    expect(a.prescription?.reasons).toContain('PROBE_PLANNED');
    expect(a.patch?.plan.exposures[0]!.sets[0]!.role).toBe('probe');
    expect(a.prescription?.sets).toBe(3);
    const one = assessSessionChange(snap, session, add('db-floor-press', 1));
    expect(one.prescription?.reasons).toContain('NO_ROOM_FOR_PROBE');
    expect(one.prescription?.perSet).toHaveLength(1);
  });
  it('a performed non-required set supplies no reference resistance', () => {
    const { snap, session } = world();
    const r = exposureOf({
      date: '2026-10-01',
      exerciseId: 'crunch',
      spec: body,
      sets: [{ amount: 10, planned: { role: 'backoff', requiredForProgression: false } }],
    });
    snap.records = [r];
    expect(assessSessionChange(snap, session, add()).patch).not.toBeNull();
  });
  it('a saved day on a different date has no tomorrow effect', () => {
    const { snap, session } = world();
    snap.tomorrow = {
      date: '2026-10-07',
      blockIndex: 1,
      phase: 'work',
      items: [],
      skipped: [],
      dayReasons: [],
    };
    expect(assessSessionChange(snap, session, add()).effects.tomorrow).toBeNull();
  });
  it('a tomorrow problem already caused by the original pending plan is not blamed on a new request', () => {
    const { snap, session } = world([recipe('crunch')]);
    snap.tomorrow = {
      date: '2026-10-06',
      blockIndex: 1,
      phase: 'work',
      items: [
        {
          slotId: 'core-front',
          exerciseId: snap.block.selections['core-front']!,
          sets: 2,
          role: 'work',
        },
      ],
      skipped: [],
      dayReasons: [],
    };
    const a = assessSessionChange(snap, session, add('standing-calf-raise', 1));
    expect(a.effects.tomorrow).toBeNull();
    expect(codes(a)).not.toContain('HURTS_TOMORROW');
  });
  it('a weekly upper bound crossed by a forecast reports all affected tomorrow slots', () => {
    const { snap, session } = world();
    // A light saved choice does not have a recovery issue; the weekly maximum still holds for its work slots.
    snap.tomorrow = {
      date: '2026-10-06',
      blockIndex: 1,
      phase: 'work',
      items: [
        {
          slotId: 'core-front',
          exerciseId: snap.block.selections['core-front']!,
          sets: 1,
          role: 'work',
        },
      ],
      skipped: [],
      dayReasons: [],
    };
    snap.records = [
      exposureOf({
        date: '2026-10-01',
        exerciseId: 'crunch',
        spec: body,
        sets: [10, 10, 10, 10, 10],
      }),
    ];
    const a = assessSessionChange(snap, session, add('crunch', 2));
    expect(a.effects.tomorrow?.reasons).toContain('VOLUME_AT_MAX');
    expect(a.effects.tomorrow?.changedSlots).toEqual(['core-front']);
  });
  it('unknown and volume-excluded exercises do not invent planned muscle load', () => {
    const { snap, session } = world([recipe('crunch')]);
    expect(remainingVolume(session.plan, new Set(), { ...snap, catalog: {} })).toEqual({});
    const noVolume = {
      ...snap,
      catalog: {
        ...snap.catalog,
        crunch: { ...snap.catalog.crunch!, movementPattern: 'Mobility' as const },
      },
    };
    expect(remainingVolume(session.plan, new Set(), noVolume)).toEqual({});
  });
  it('unknown actual exercises are ignored for overlap, and shared muscles with another pattern only warn', () => {
    const { snap, session } = world([recipe('crunch')]);
    const actual = perform(session)[0]!;
    actual.sessionId = 'other';
    actual.exerciseId = 'unknown';
    snap.records = [actual];
    expect(
      assessSessionChange(snap, { ...session, records: [] }, add('dead-bug', 1)).effects
        .overlapToday,
    ).toEqual([]);
    snap.catalog = {
      ...snap.catalog,
      crunch: { ...snap.catalog.crunch!, movementPattern: 'Pull' },
    };
    actual.exerciseId = 'crunch';
    const a = assessSessionChange(snap, { ...session, records: [] }, add('dead-bug', 1));
    expect(a.checks).toContainEqual(
      expect.objectContaining({ code: 'OVERLAP_TODAY', status: 'warn' }),
    );
  });
  it('a change that carries on an exercise in progress does not overlap with its own earlier sets', () => {
    const { snap, session } = world([recipe('db-floor-press', 3)]);
    session.records = perform(session, 1);
    const id = session.plan.exposures[0]!.id;
    for (const change of [
      { kind: 'reduce_remaining', exposureId: id, easier: true },
      { kind: 'reduce_remaining', exposureId: id, dropSets: 1 },
      { kind: 'add_sets', exposureId: id, sets: 1 },
    ] as const) {
      const a = assessSessionChange(snap, session, change);
      expect(codes(a)).not.toContain('OVERLAP_TODAY');
      expect(a.effects.overlapToday).toEqual([]);
    }
    // Starting the same exercise again as a new exposure is still the same movement done today.
    const again = assessSessionChange(snap, session, add('db-floor-press', 1));
    expect(again.effects.overlapToday).toContainEqual(
      expect.objectContaining({ exerciseId: 'db-floor-press', samePattern: true }),
    );
  });
  it('effects support partial day balances with no prefilled muscle keys', () => {
    const { snap, session } = world();
    const state = assessmentDay(snap, [], 1800);
    const a = changeEffects(
      snap,
      session,
      [],
      new Set(),
      session.plan,
      { ...state.day, doneToday: {} },
      state.previous,
      null,
      0,
      0,
    );
    expect(a.effects.musclesToday.core?.done).toBe(0);
  });
  it('completed plate setup keeps its original cost while pending setups are recompiled', () => {
    const { session } = world([
      recipe('db-floor-press', 2, { group: 'A' }),
      recipe('db-romanian-deadlift', 2, { group: 'A' }),
    ]);
    session.records = perform(session);
    const a = revisePending(session, [], revisionBase(session.plan, modelFor));
    expect(a.plan.execution.steps).toEqual(session.plan.execution.steps);
    expect(a.plan.time).toEqual(session.plan.time);
  });
});
