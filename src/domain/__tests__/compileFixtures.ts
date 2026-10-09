/**
 * Recipes to compile (engine, P4): a bilateral exercise on paired dumbbells,
 * a one-sided one, a hold, a superset. Not a suite and not counted in coverage.
 */
import { type CompileInput, type ExposureSpec, type SetSpec, stampPlan } from '../plan/compile';
import type { ResistanceModel, ResistanceSpec } from '../resistance/types';
import { HASH_A } from './planFixtures';
import { BODY, PAIRED, SINGLE, body, kg, single } from './progressionFixtures';

export const MODELS: Record<string, ResistanceModel> = {
  'dumbbell.paired': PAIRED,
  'dumbbell.single': SINGLE,
  bodyweight: BODY,
};
export const modelOf = (spec: ResistanceSpec): ResistanceModel | null =>
  MODELS[spec.modelId] ?? null;

export const VERSIONS = {
  engine: '2.0.0',
  policies: 'policy-2.0',
  catalog: 'catalog-1',
  inventory: 'inventory-1',
  compiler: 'compiler-1',
  traceSchema: 1,
} as const;

export const set = (patch: Partial<SetSpec> = {}): SetSpec => ({
  role: 'work',
  resistance: kg(4),
  lo: 8,
  target: 10,
  hi: 12,
  targetRir: { min: 2, max: 3 },
  restAfterSec: 60,
  required: true,
  ...patch,
});

export function exposure(key: string, patch: Partial<ExposureSpec> = {}): ExposureSpec {
  return {
    key,
    slotId: `slot-${key}`,
    exercise: { id: `ex-${key}`, definitionRevision: 'r1', displayName: `Ćwiczenie ${key}` },
    comparisonKey: `ex-${key}|dumbbell.paired|external_mass/per_hand/x2`,
    scope: 'primary',
    policy: { id: 'reps_then_resistance', version: '2' },
    unit: 'reps',
    sideMode: 'bilateral',
    sets: [set(), set()],
    group: null,
    bandWarmup: false,
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

export function compileInput(
  exposures: readonly ExposureSpec[],
  patch: Partial<CompileInput> = {},
): CompileInput {
  return {
    sessionId: 's1',
    planRevision: 1,
    kind: 'main',
    source: 'engine',
    trainingDate: '2026-10-09',
    versions: VERSIONS,
    inputFingerprint: HASH_A,
    exposures,
    bikeSec: 600,
    modelOf,
    ...patch,
  };
}

export const stamp = (draft: Parameters<typeof stampPlan>[0]) =>
  stampPlan(draft, { mode: 'new_plan', snapshotFingerprint: HASH_A, overrides: [] });

export { BODY, PAIRED, SINGLE, body, kg, single };
