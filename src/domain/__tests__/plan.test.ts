/**
 * Engine v2, P1 (07 P1.1, T08, T09, T41): the plan contract — legal and
 * rejected examples.
 */
import { fingerprint, fingerprintWithout } from '../fingerprint';
import {
  exposureId,
  logicalSetId,
  parseExposureId,
  parsePlannedSetId,
  plannedSetId,
} from '../plan/ids';
import {
  auditStampSchema,
  decisionTraceSchema,
  executionStepSchema,
  quantityTargetSchema,
  sessionPlanSchema,
  timeBreakdownSchema,
} from '../plan/plan';
import { HASH_A, legalPlan, plannedSet } from './planFixtures';

const parses = (candidate: unknown) => sessionPlanSchema.safeParse(candidate).success;
const messages = (candidate: unknown) => {
  const result = sessionPlanSchema.safeParse(candidate);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe('ids', () => {
  it('builds the three kinds of id from the same parts', () => {
    const parts = { sessionId: 's1', planRevision: 1, exposureKey: 'e1', ordinal: 2 };
    expect(exposureId('s1', 1, 'e1')).toBe('s1/r1/e1');
    expect(logicalSetId(parts)).toBe('s1/r1/e1/2');
    expect(plannedSetId({ ...parts, side: 'left' })).toBe('s1/r1/e1/2L');
    expect(plannedSetId({ ...parts, side: 'right' })).toBe('s1/r1/e1/2R');
    expect(plannedSetId({ ...parts, side: null })).toBe('s1/r1/e1/2');
  });

  it('reads them back, and says no to text that is not an id', () => {
    for (const side of ['left', 'right', null] as const) {
      const parts = { sessionId: 'abc-1_x', planRevision: 12, exposureKey: 'e7', ordinal: 3, side };
      expect(parsePlannedSetId(plannedSetId(parts))).toEqual(parts);
    }
    expect(parseExposureId('s1/r2/e4')).toEqual({
      sessionId: 's1',
      planRevision: 2,
      exposureKey: 'e4',
    });
    for (const bad of [
      '',
      's1',
      's1/r0/e1/1',
      's1/r1/e1/0',
      's1/r1/e1/1X',
      's1/1/e1/1',
      'a b/r1/e1/1',
    ]) {
      expect(parsePlannedSetId(bad)).toBeNull();
    }
    expect(parseExposureId('s1/r1')).toBeNull();
  });

  it('refuses parts that could be taken for a separator, and numbers that are not counts', () => {
    expect(() => exposureId('s/1', 1, 'e1')).toThrow(RangeError);
    expect(() => exposureId('s1', 1, 'e 1')).toThrow(RangeError);
    expect(() => exposureId('s1', 0, 'e1')).toThrow(RangeError);
    expect(() => exposureId('s1', 1.5, 'e1')).toThrow(RangeError);
    expect(() =>
      logicalSetId({ sessionId: 's1', planRevision: 1, exposureKey: 'e1', ordinal: 0 }),
    ).toThrow(RangeError);
  });
});

describe('a legal plan', () => {
  it('is accepted, with four planned sets for two logical sets of a one-sided exercise (T08)', () => {
    const plan = legalPlan();
    expect(sessionPlanSchema.parse(plan)).toEqual(plan);
    expect(plan.exposures[0]!.sets.map((s) => s.id)).toEqual([
      's1/r1/e1/1L',
      's1/r1/e1/1R',
      's1/r1/e1/2L',
      's1/r1/e1/2R',
    ]);
  });

  it('survives JSON and keeps one fingerprint, with or without the hash of its own audit', () => {
    const plan = legalPlan();
    const again = JSON.parse(JSON.stringify(plan)) as unknown;
    expect(fingerprint(again)).toBe(fingerprint(plan));
    expect(fingerprintWithout(plan, 'audit')).toBe(
      fingerprintWithout({ ...plan, audit: { ...plan.audit, planHash: HASH_A } }, 'audit'),
    );
    expect(fingerprint(plan)).not.toBe(fingerprint(legalPlan({ trainingDate: '2026-10-10' })));
  });

  it('allows an empty plan: a day with nothing to train is a plan, not an error', () => {
    const empty = legalPlan({
      exposures: [],
      execution: { steps: [] },
      time: {
        hardWork: 0,
        practice: 0,
        mobility: 0,
        warmup: 0,
        rest: 0,
        setup: 0,
        transition: 0,
        exerciseTotal: 0,
        bike: 600,
        overall: 600,
      },
    });
    expect(parses(empty)).toBe(true);
  });

  it('lets a later revision add a set to an exposure, with the id of the revision that added it', () => {
    const plan = legalPlan({ planRevision: 2 });
    plan.exposures[0]!.sets.push(plannedSet(3, null, { side: 'bilateral' }, 's1', 2, 'e1'));
    plan.execution.steps.push({
      kind: 'perform',
      id: 'p9',
      plannedSetId: 's1/r2/e1/3',
      mode: 'reps',
    });
    plan.time = { ...plan.time };
    expect(messages(plan)).toEqual([]);
  });

  it('accepts every kind of step and target', () => {
    expect(
      executionStepSchema.safeParse({
        kind: 'setup',
        id: 'x',
        resources: [{ resourceId: 'dumbbell-set', quantity: 2, configuration: 'paired:8000' }],
        estimatedSec: 40,
      }).success,
    ).toBe(true);
    expect(
      executionStepSchema.safeParse({ kind: 'cue', id: 'c', cueCode: 'STRETCH_BAND' }).success,
    ).toBe(true);
    expect(
      executionStepSchema.safeParse({
        kind: 'transition',
        id: 't',
        from: 'a',
        to: 'b',
        estimatedSec: 20,
      }).success,
    ).toBe(true);
    expect(
      quantityTargetSchema.safeParse({ kind: 'duration', minSec: 20, targetSec: 30, maxSec: 60 })
        .success,
    ).toBe(true);
    expect(quantityTargetSchema.safeParse({ kind: 'distance', targetMeters: 400 }).success).toBe(
      true,
    );
  });
});

describe('rejected plans', () => {
  const at = <T>(mutate: (plan: ReturnType<typeof legalPlan>) => T) => {
    const plan = legalPlan();
    mutate(plan);
    return plan;
  };

  it.each([
    ['another schema version', { ...legalPlan(), schemaVersion: 1 }],
    ['an unknown field', { ...legalPlan(), extra: true }],
    ['a date that is not a date', legalPlan({ trainingDate: '9.10.2026' })],
    ['a fingerprint that is not a hash', legalPlan({ inputFingerprint: 'abc' })],
    ['a revision of zero', legalPlan({ planRevision: 0 })],
    ['a kind nobody knows', { ...legalPlan(), kind: 'weekly' }],
  ])('%s', (_, plan) => {
    expect(parses(plan)).toBe(false);
  });

  it('two sets with one id', () => {
    const plan = at((p) => {
      p.exposures[0]!.sets[1] = { ...p.exposures[0]!.sets[0]! };
    });
    expect(messages(plan).join('|')).toContain('planned set ids are unique');
  });

  it('a step for a set that is not planned (T41)', () => {
    const plan = at((p) => {
      p.execution.steps.push({
        kind: 'perform',
        id: 'ghost',
        plannedSetId: 's1/r1/e1/9',
        mode: 'reps',
      });
    });
    expect(messages(plan).join('|')).toContain('which is not planned');
  });

  it('a planned set no step performs, and one performed twice (T08)', () => {
    const missing = at((p) => {
      p.execution.steps = p.execution.steps.filter((s) => !(s.kind === 'perform' && s.id === 'p3'));
    });
    expect(messages(missing).join('|')).toContain('s1/r1/e1/2R is performed 0 times');
    const twice = at((p) => {
      p.execution.steps.push({
        kind: 'perform',
        id: 'again',
        plannedSetId: 's1/r1/e1/1L',
        mode: 'reps',
      });
    });
    expect(messages(twice).join('|')).toContain('s1/r1/e1/1L is performed 2 times');
  });

  it('repeated step ids and exposure ids', () => {
    const steps = at((p) => {
      p.execution.steps[1] = { ...p.execution.steps[0]! };
    });
    expect(messages(steps).join('|')).toContain('step ids are unique');
    const exposures = at((p) => {
      p.exposures.push({ ...p.exposures[0]!, sets: [plannedSet(1, null, {}, 's1', 1, 'e2')] });
      p.exposures[1]!.id = 's1/r1/e1';
    });
    expect(messages(exposures).join('|')).toContain('exposure ids are unique');
  });

  it('a set from another session, from the future, or from another exposure', () => {
    const other = at((p) => {
      p.exposures[0]!.sets[0] = plannedSet(1, 'left', {}, 's2');
    });
    expect(messages(other).join('|')).toContain('belongs to another session');
    const future = at((p) => {
      p.exposures[0]!.sets[0] = plannedSet(1, 'left', {}, 's1', 3);
    });
    expect(messages(future).join('|')).toContain('does not exist yet');
    const elsewhere = at((p) => {
      p.exposures[0]!.sets[0] = plannedSet(1, 'left', {}, 's1', 1, 'e9');
    });
    expect(messages(elsewhere).join('|')).toContain('is not in the exposure');
    const older = legalPlan({ planRevision: 2 });
    older.exposures[0]!.id = 's1/r2/e1';
    expect(messages(older).join('|')).toContain('is not in the exposure');
  });

  it('an exposure of another session, from the future, or with no id to speak of', () => {
    const other = at((p) => {
      p.exposures[0]!.id = 's2/r1/e1';
    });
    expect(messages(other).join('|')).toContain('belongs to another session');
    const future = at((p) => {
      p.exposures[0]!.id = 's1/r5/e1';
    });
    expect(messages(future).join('|')).toContain('is from the future');
    const nonsense = at((p) => {
      p.exposures[0]!.id = 'exposure one';
    });
    expect(messages(nonsense).join('|')).toContain('is not an exposure id');
  });

  it('the two sides of one set that differ, or repeat', () => {
    const roles = at((p) => {
      p.exposures[0]!.sets[1] = plannedSet(1, 'right', {
        role: 'backoff',
        requiredForProgression: false,
      });
    });
    expect(messages(roles).join('|')).toContain('mixes roles');
    const twice = at((p) => {
      p.exposures[0]!.sets[1] = plannedSet(1, 'left', { id: 's1/r1/e1/1L' });
    });
    expect(messages(twice).join('|')).toContain('repeats a side');
    const ordinals = at((p) => {
      p.exposures[0]!.sets[1] = plannedSet(1, 'right', { ordinal: 2 });
    });
    expect(messages(ordinals).join('|')).toContain('the id carries the ordinal');
  });

  it('a set that disagrees with its own id', () => {
    const side = at((p) => {
      p.exposures[0]!.sets[0] = plannedSet(1, 'left', { side: 'right' });
    });
    expect(messages(side).join('|')).toContain('the side in the id is the side of the set');
    const logical = at((p) => {
      p.exposures[0]!.sets[0] = plannedSet(1, 'left', { logicalSetId: 's1/r1/e1/7' });
    });
    expect(messages(logical).join('|')).toContain('the logical set is the id without its side');
    const noSide = at((p) => {
      p.exposures[0]!.sets[0] = plannedSet(1, null, {
        id: 's1/r1/e1/1',
        logicalSetId: 's1/r1/e1/1',
        side: 'left',
      });
    });
    expect(messages(noSide).join('|')).toContain('the side in the id is the side of the set');
    const notAnId = at((p) => {
      p.exposures[0]!.sets[0] = plannedSet(1, 'left', { id: 'one' });
    });
    expect(messages(notAnId).join('|')).toContain('the id of a planned set is');
  });

  it.each(['warmup', 'backoff', 'practice', 'mobility', 'probe'] as const)(
    'a %s set that is required for progression (T25, T26, T92)',
    (role) => {
      const plan = at((p) => {
        p.exposures[0]!.sets[0] = plannedSet(1, 'left', { role, requiredForProgression: true });
      });
      expect(messages(plan).join('|')).toContain('only a working set is required');
    },
  );

  it('a target without a range, with a missing size, or going nowhere', () => {
    for (const target of [
      { kind: 'reps', min: 12, target: 8, max: 12, count: 'total' },
      { kind: 'reps', min: 8, target: 12, max: 10, count: 'total' },
      { kind: 'reps', min: 0, target: 12, max: 12, count: 'total' },
      { kind: 'reps', min: 8, target: 12, max: 12 },
      { kind: 'duration', minSec: 60, targetSec: 30, maxSec: 90 },
      { kind: 'distance', targetMeters: 0 },
      { kind: 'tempo' },
    ]) {
      expect(quantityTargetSchema.safeParse(target).success).toBe(false);
    }
    const plan = at((p) => {
      p.exposures[0]!.sets[0] = plannedSet(1, 'left', { targetRir: { min: 3, max: 1 } });
    });
    expect(parses(plan)).toBe(false);
  });

  it('a time whose parts do not add up, or that counts the bike twice (invariant 12)', () => {
    const base = legalPlan().time;
    expect(timeBreakdownSchema.safeParse(base).success).toBe(true);
    expect(timeBreakdownSchema.safeParse({ ...base, rest: base.rest + 1 }).success).toBe(false);
    expect(timeBreakdownSchema.safeParse({ ...base, overall: base.overall + 600 }).success).toBe(
      false,
    );
    expect(timeBreakdownSchema.safeParse({ ...base, hardWork: -1 }).success).toBe(false);
    expect(timeBreakdownSchema.safeParse({ ...base, setup: 1.5 }).success).toBe(false);
    expect(parses(legalPlan({ time: { ...base, overall: 1 } }))).toBe(false);
  });

  it('an audit stamp without hashes, and a trace without a code', () => {
    const stamp = legalPlan().audit;
    expect(auditStampSchema.safeParse({ ...stamp, planHash: 'x' }).success).toBe(false);
    expect(auditStampSchema.safeParse({ ...stamp, mode: 'whenever' }).success).toBe(false);
    expect(auditStampSchema.safeParse({ ...stamp, overrides: [''] }).success).toBe(false);
    const trace = legalPlan().exposures[0]!.trace;
    expect(decisionTraceSchema.safeParse(trace).success).toBe(true);
    expect(decisionTraceSchema.safeParse({ ...trace, code: '' }).success).toBe(false);
    expect(decisionTraceSchema.safeParse({ ...trace, schemaVersion: 2 }).success).toBe(false);
  });
});
