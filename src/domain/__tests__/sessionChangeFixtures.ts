import lexicon from '@data/movement-terms.json';
import { movementLexiconSchema } from '@data/movement-terms.schema';
import { compileSession, stampPlan, type ExposureSpec } from '../plan/compile';
import { resistanceOf, modelFor } from '../plan/resistanceOf';
import { unitOf } from '../progression/prescribe';
import { recordsOf, FOLLOWS_THE_PLAN_V2 } from '../plan/simulateV2';
import type { ExposureRecord } from '../observations/exposure';
import type { ActiveSessionState, SessionChangeSnapshot } from '../session/types';
import { dayInput, CATALOG, SLOTS } from './dayV2Fixtures';
import { HASH_A } from './planV2Fixtures';

export function recipe(id: string, n = 2, patch: Partial<ExposureSpec> = {}): ExposureSpec {
  const exercise = CATALOG[id]!;
  const slot = SLOTS.find((s) => s.exerciseIds.includes(id))!;
  const res = resistanceOf(exercise, slot)!;
  const unit = unitOf(exercise) === 'sec' ? 'duration' : 'reps';
  return {
    key: id,
    slotId: slot.id,
    exercise: { id, definitionRevision: '6', displayName: exercise.name },
    comparisonKey: res.comparisonKey,
    scope: 'primary',
    policy: { id: 'reps_then_resistance', version: '2' },
    unit,
    sideMode:
      exercise.sides === 'perSet'
        ? 'per_set'
        : exercise.sides === 'alternating'
          ? 'alternating'
          : 'bilateral',
    sets: Array.from({ length: n }, () => ({
      role: 'work',
      resistance: res.start,
      lo: 8,
      target: 10,
      hi: 15,
      targetRir: { min: 2, max: 3 },
      restAfterSec: 60,
      required: true,
    })),
    group: null,
    bandWarmup: exercise.equipment.includes('band'),
    trace: {
      schemaVersion: 1,
      decision: 'hold',
      code: 'REP_PROGRESSION',
      policy: { id: 'reps_then_resistance', version: '2' },
      evidence: {},
      estimate: null,
    },
    ...patch,
  };
}

export function world(specs: ExposureSpec[] = []): {
  snap: SessionChangeSnapshot;
  session: ActiveSessionState;
} {
  const input = dayInput();
  const snap: SessionChangeSnapshot = {
    ...input,
    lexicon: movementLexiconSchema.parse(lexicon),
    historyRevision: 7,
    prefsRevision: 2,
    tomorrow: null,
  };
  const plan = stampPlan(
    compileSession({
      sessionId: 's1',
      planRevision: 1,
      kind: 'main',
      source: 'engine',
      trainingDate: snap.asOf,
      versions: snap.session.versions,
      inputFingerprint: HASH_A,
      bikeSec: 0,
      exposures: specs,
      modelOf: (s) => modelFor(s),
    }),
    { mode: 'new_plan', snapshotFingerprint: HASH_A, overrides: [] },
  );
  const records = recordsOf(plan, FOLLOWS_THE_PLAN_V2).map((r) => ({
    ...r,
    sets: r.sets.map((s) => ({ ...s, disposition: 'pending' as const, observation: null })),
  }));
  return { snap, session: { plan, records } };
}

export function perform(session: ActiveSessionState, count = Infinity): ExposureRecord[] {
  const full = recordsOf(session.plan, FOLLOWS_THE_PLAN_V2);
  let seen = 0;
  return full.map((r) => ({
    ...r,
    sets: r.sets.map((s) =>
      ++seen <= count ? s : { ...s, disposition: 'pending', observation: null },
    ),
  }));
}
