/**
 * A small, controlled world to plan a day in (engine, P4): a few exercises
 * and slots whose every property the tests know. Not a suite and not counted in coverage.
 */
import type { DayInput } from '../plan/day';
import { resistanceOf } from '../plan/resistanceOf';
import { nextCandidate } from '../plan/blockSelection';
import { defaultPreferences } from '../preferences/preferences';
import type { Exercise, MuscleGroup } from '../types';
import type { Slot } from '../plan/types';
import { type ExposureOptions, exposureOf } from './progressionFixtures';
import { VERSIONS } from './compileFixtures';
import { exercise, HARD_ONLY, slot } from './fixtures';
import { HASH_A } from './planFixtures';
const rotateSelections = (
  _previous: null,
  slots: readonly import('../plan/types').Slot[],
  catalog: Readonly<Record<string, import('../types').Exercise>>,
  eligibility: import('../plan/eligibility').EligibilityContext,
) =>
  Object.fromEntries(
    slots.flatMap((slot) => {
      const id = nextCandidate(slot, undefined, catalog, eligibility);
      return id ? [[slot.id, id]] : [];
    }),
  );

const dumbbell = (id: string, primary: MuscleGroup[], patch: Partial<Exercise> = {}) =>
  exercise({
    id,
    name: id,
    equipment: ['dumbbell'],
    primaryMuscles: primary,
    secondaryMuscles: [],
    ...patch,
  });

export const EXERCISES: Exercise[] = [
  dumbbell('sq', ['quads', 'glutes']),
  dumbbell('sl', ['quads', 'glutes'], {
    movementPattern: 'Lunge',
    stanceMechanics: 'UnilateralSupported',
  }),
  dumbbell('bi', ['quads', 'glutes'], { movementPattern: 'Lunge' }),
  dumbbell('bp', ['chest'], { movementPattern: 'Push' }),
  dumbbell('rw', ['back'], { movementPattern: 'Pull', dumbbellMode: 'single' }),
  dumbbell('cu', ['biceps'], { movementPattern: 'Isolation' }),
  exercise({
    id: 'pl',
    name: 'pl',
    movementPattern: 'Core',
    forceProfile: 'Isometric',
    primaryMuscles: ['core'],
    equipment: ['bodyweight'],
  }),
  exercise({
    id: 'sp',
    name: 'sp',
    movementPattern: 'Core',
    forceProfile: 'Isometric',
    primaryMuscles: ['core'],
    equipment: ['bodyweight'],
    sides: 'perSet',
    stanceMechanics: 'UnilateralSupported',
  }),
  exercise({
    id: 'bd',
    name: 'bd',
    movementPattern: 'Core',
    primaryMuscles: ['core'],
    equipment: ['bodyweight'],
    sides: 'alternating',
  }),
  exercise({
    id: 'ba',
    name: 'ba',
    movementPattern: 'Pull',
    primaryMuscles: ['shoulders'],
    equipment: ['band'],
  }),
  exercise({
    id: 'mb',
    name: 'mb',
    movementPattern: 'Mobility',
    primaryMuscles: ['back'],
    equipment: ['bodyweight'],
  }),
  exercise({
    id: 'cr',
    name: 'cr',
    movementPattern: 'Core',
    primaryMuscles: ['core'],
    equipment: ['bodyweight'],
    progressions: [{ to: 'dd', kind: 'easier' }],
  }),
  exercise({
    id: 'dd',
    name: 'dd',
    movementPattern: 'Core',
    primaryMuscles: ['core'],
    equipment: ['bodyweight'],
  }),
  exercise({
    id: 'xx',
    name: 'xx',
    movementPattern: 'Nowhere' as never,
    primaryMuscles: ['calves'],
    equipment: ['band'],
  }),
  dumbbell('sleg', ['quads'], {
    sides: 'perSet',
    stanceMechanics: 'UnilateralSupported',
    movementPattern: 'Lunge',
  }),
];
export const CAT: Record<string, Exercise> = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

const S = (patch: Partial<Slot> & Pick<Slot, 'id' | 'exerciseIds'>): Slot =>
  slot({
    name: patch.id,
    restSec: 60,
    rir: [2, 3],
    start: { paired: 4, single: 8, band: 'red' },
    ...patch,
  });

export const SLOTS_W: Slot[] = [
  S({ id: 'squat', exerciseIds: ['sq'], kind: 'compound', region: 'lower', repRange: [8, 12] }),
  S({
    id: 'lunge',
    exerciseIds: ['sl', 'bi'],
    kind: 'compound',
    region: 'lower',
    repRange: [8, 12],
  }),
  S({ id: 'press', exerciseIds: ['bp'], kind: 'compound', region: 'push', repRange: [8, 12] }),
  S({ id: 'row', exerciseIds: ['rw'], kind: 'compound', region: 'pull', repRange: [8, 12] }),
  S({ id: 'curl', exerciseIds: ['cu'], kind: 'accessory', region: 'arms', repRange: [8, 12] }),
  S({
    id: 'abs',
    exerciseIds: ['cr'],
    kind: 'core',
    region: 'core',
    repRange: [8, 12],
    lightFill: true,
  }),
  S({
    id: 'core',
    exerciseIds: ['pl'],
    kind: 'core',
    region: 'core',
    timeRange: [20, 60],
    lightFill: true,
  }),
  S({
    id: 'core2',
    exerciseIds: ['sp'],
    kind: 'core',
    region: 'core',
    timeRange: [15, 45],
    lightFill: true,
  }),
  S({ id: 'core3', exerciseIds: ['bd'], kind: 'core', region: 'core', repRange: [8, 12] }),
  S({
    id: 'rear',
    exerciseIds: ['ba'],
    kind: 'accessory',
    region: 'shoulders',
    repRange: [10, 15],
    lightFill: true,
  }),
  S({ id: 'mob', exerciseIds: ['mb'], kind: 'filler', region: 'mobility', repRange: [8, 15] }),
];

export const ELIGIBLE = { profile: HARD_ONLY, excludedIds: new Set<string>() };
export const PICK = Object.fromEntries(
  SLOTS_W.filter((s) => s.kind !== 'filler').map((s) => [s.id, s.exerciseIds[0]!]),
) as Record<string, string>;
export const SELECT = rotateSelections(null, SLOTS_W, CAT, ELIGIBLE);

export function world(patch: Partial<DayInput> = {}): DayInput {
  return {
    asOf: '2026-10-14',
    catalog: CAT,
    slots: SLOTS_W,
    eligibility: ELIGIBLE,
    block: {
      index: 1,
      startedOn: '2026-10-05',
      deloadFrom: null,
      deloadReason: null,
      selections: PICK,
    },
    records: [],
    rides: [],
    daily: [],
    preferences: defaultPreferences(),
    session: {
      sessionId: 's1',
      planRevision: 1,
      kind: 'main',
      versions: VERSIONS,
      snapshotFingerprint: HASH_A,
      inputFingerprint: HASH_A,
    },
    ...patch,
  };
}

/** What was done on a date in a slot, as the planner reads the history of its exercise. */
export function did(
  date: string,
  slotId: string,
  sets: ExposureOptions['sets'],
  patch: Partial<ExposureOptions> = {},
) {
  const s = SLOTS_W.find((x) => x.id === slotId)!;
  const id = PICK[slotId] ?? s.exerciseIds[0]!;
  const res = resistanceOf(CAT[id]!, s)!;
  return exposureOf({
    date,
    spec: res.start,
    sets,
    exerciseId: id,
    slotId,
    key: res.comparisonKey,
    seconds: CAT[id]!.forceProfile === 'Isometric',
    ...patch,
  });
}
