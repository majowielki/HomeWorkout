/**
 * Shared builders for the rules-engine tests. Not a suite (jest.config.js
 * only runs *.test files) and not counted in coverage.
 */
import type { Slot } from '../plan/types';
import type { Exercise, KneeProfile, MedicalProfile } from '../types';

/** Minimal valid exercise; tests override only what they assert on. */
export function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'test',
    name: 'Test',
    movementPattern: 'Squat',
    planesOfMotion: ['Sagittal'],
    isClosedKineticChain: true,
    stanceMechanics: 'Bilateral',
    forceProfile: 'ConcentricEccentric',
    loadsKnee: false,
    provokesValgusVarus: false,
    highAnteriorTibialShear: false,
    primaryMuscles: ['quads'],
    secondaryMuscles: [],
    equipment: ['bodyweight'],
    bandSuitability: 'ok',
    substituteIds: [],
    media: null,
    cues: ['cue'],
    ...overrides,
  };
}

export function slot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: 'slot',
    name: 'Slot',
    kind: 'compound',
    region: 'lower',
    exerciseIds: ['test'],
    repRange: [10, 20],
    rir: [2, 3],
    restSec: 90,
    start: { paired: 4, single: 8, band: 'red' },
    ...overrides,
  };
}

/** The documented knee: no collaterals, ACL graft, varus thrust. */
export const DOCUMENTED_KNEE: KneeProfile = {
  side: 'right',
  missingCollaterals: true,
  aclReconstructed: true,
  varusThrust: true,
  physioApproved: false,
};

/** What the user chose on 2026-10-02: hard exclusions only (SPEC §10, IMPLEMENTACJA §0.1). */
export const HARD_ONLY: MedicalProfile = { knee: { ...DOCUMENTED_KNEE, physioApproved: true } };

export const CONSERVATIVE: MedicalProfile = { knee: DOCUMENTED_KNEE };

export const HEALTHY: MedicalProfile = { knee: null };

export const byId = (list: readonly Exercise[]): Record<string, Exercise> =>
  Object.fromEntries(list.map((e) => [e.id, e]));
