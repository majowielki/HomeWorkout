/**
 * A legal v2 plan and result to build examples from: the one-sided exercise of
 * 10 §4 — two sets, each done on the left and then on the right, 4 kg on one
 * implement, target 8-12. Not a suite and not counted in coverage.
 */
import { specFromLoad } from '../resistance/legacy';
import { plannedSetId } from '../plan/ids';
import type { PlannedSet, SessionPlanV2 } from '../plan/planV2';
import type { SetObservation } from '../observations/types';

export const HASH_A = 'a'.repeat(64);
export const HASH_B = 'b'.repeat(64);

export const FOUR_KG = specFromLoad({ kind: 'dumbbell', mode: 'single', kg: 4 });

export function plannedSet(
  ordinal: number,
  side: 'left' | 'right' | null,
  patch: Partial<PlannedSet> = {},
  sessionId = 's1',
  planRevision = 1,
  exposureKey = 'e1',
): PlannedSet {
  const id = plannedSetId({ sessionId, planRevision, exposureKey, ordinal, side });
  return {
    id,
    logicalSetId: plannedSetId({ sessionId, planRevision, exposureKey, ordinal, side: null }),
    comparisonGroupId: `${sessionId}/r${planRevision}/${exposureKey}/work`,
    role: 'work',
    side: side ?? 'bilateral',
    ordinal,
    target: { kind: 'reps', min: 8, target: 12, max: 12, count: 'per_side' },
    resistance: FOUR_KG,
    targetRir: { min: 2, max: 3 },
    restAfterSec: 60,
    requiredForProgression: true,
    ...patch,
  };
}

/** Four sets (2 logical x 2 sides), their steps, and a time that adds up. */
export function legalPlan(patch: Partial<SessionPlanV2> = {}): SessionPlanV2 {
  const sets = [
    plannedSet(1, 'left'),
    plannedSet(1, 'right'),
    plannedSet(2, 'left'),
    plannedSet(2, 'right'),
  ];
  return {
    schemaVersion: 2,
    sessionId: 's1',
    planRevision: 1,
    kind: 'main',
    source: 'engine',
    trainingDate: '2026-10-09',
    versions: {
      engine: '2.0.0',
      policies: 'policy-2.0',
      catalog: 'catalog-1',
      inventory: 'inventory-1',
      compiler: 'compiler-1',
      traceSchema: 1,
    },
    inputFingerprint: HASH_A,
    exposures: [
      {
        id: 's1/r1/e1',
        slotId: 'pull-horizontal',
        exercise: {
          id: 'one-arm-db-row',
          definitionRevision: 'r1',
          displayName: 'Wiosłowanie jednorącz',
        },
        comparisonKey: 'one-arm-db-row|dumbbell.single|external_mass/total/x1',
        progressionScope: 'primary',
        prescriptionPolicy: { id: 'reps_then_resistance', version: '2' },
        sets,
        trace: {
          schemaVersion: 1,
          decision: 'start',
          code: 'FIRST_COMPARABLE_EXPOSURE',
          policy: { id: 'reps_then_resistance', version: '2' },
          evidence: {},
          estimate: null,
        },
      },
    ],
    execution: {
      steps: sets.flatMap((s, i) => [
        { kind: 'perform' as const, id: `p${i}`, plannedSetId: s.id, mode: 'reps' as const },
        { kind: 'rest' as const, id: `r${i}`, durationSec: 60, afterSetId: s.id },
      ]),
    },
    time: {
      hardWork: 192,
      practice: 0,
      mobility: 0,
      warmup: 0,
      rest: 240,
      setup: 0,
      transition: 30,
      exerciseTotal: 462,
      bike: 600,
      overall: 1062,
    },
    audit: { mode: 'new_plan', planHash: HASH_B, snapshotFingerprint: HASH_A, overrides: [] },
    ...patch,
  };
}

/** A confirmed-as-planned result: the person saw 12 x 4 kg, RIR 2 and tapped save. */
export function legalObservation(patch: Partial<SetObservation> = {}): SetObservation {
  const shown = {
    origin: 'user_confirmed' as const,
    channel: 'touch' as const,
    confirmedAt: '2026-10-09T08:00:00.000Z',
    presentedDefault: true,
    confirmation: 'visible' as const,
  };
  return {
    id: 'obs-1',
    commandId: 'cmd-1',
    revision: 1,
    sessionId: 's1',
    exposureId: 's1/r1/e1',
    plannedSetId: 's1/r1/e1/1L',
    logicalSetId: 's1/r1/e1/1',
    side: 'left',
    status: 'performed',
    amount: { value: { kind: 'reps', reps: 12 }, ...shown },
    resistance: { value: FOUR_KG, ...shown },
    rir: { value: 2, ...shown },
    shortfall: null,
    performedAt: '2026-10-09T08:00:00.000Z',
    recordedAt: '2026-10-09T08:00:01.000Z',
    ...patch,
  };
}
