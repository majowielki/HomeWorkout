/**
 * Engine v2, P1 (D25, 12 §3-§4, T73-T75): what the person prefers decides
 * between near-equal options and nothing else.
 */
import exercisesJson from '@data/exercises.json';
import slotsJson from '@data/slots.json';
import { exerciseCatalogueSchema } from '@data/exercises.schema';
import { slotCatalogueSchema } from '@data/slots.schema';

import { slotByExercise } from '../plan/eligibility';
import {
  defaultPreferences,
  nearEquivalent,
  preferenceScore,
  trainingPreferencesSchema,
  type TrainingPreferences,
} from '../preferences/preferences';
import type { Exercise } from '../types';
import { exercise, slot } from './fixtures';

const real = exerciseCatalogueSchema.parse(exercisesJson).exercises as Exercise[];
const byId = Object.fromEntries(real.map((e) => [e.id, e]));
const realSlotOf = slotByExercise(slotCatalogueSchema.parse(slotsJson).slots);

const prefs = (patch: Partial<TrainingPreferences> = {}): TrainingPreferences => ({
  ...defaultPreferences(),
  ...patch,
});

describe('the preferences themselves', () => {
  it('start with nothing preferred, the engine choosing the sets, and the standard volume', () => {
    expect(defaultPreferences()).toEqual({
      revision: 0,
      equipment: {},
      exercises: {},
      setsPerExposure: { mode: 'engine' },
      variety: 'normal',
      volumeProfile: 'standard',
      volumeOverrides: {},
      muscleWeights: {},
    });
    expect(trainingPreferencesSchema.parse(defaultPreferences())).toEqual(defaultPreferences());
  });

  it('accept what a settings screen would write', () => {
    const chosen = prefs({
      revision: 3,
      equipment: { band: 'prefer', dumbbell: 'avoid' },
      exercises: { 'goblet-squat': 'prefer' },
      setsPerExposure: { mode: 'fixed', byKind: { compound: 4, core: 2 } },
      variety: 'varied',
      volumeProfile: 'higher',
      volumeOverrides: { shoulders: 8 },
      muscleWeights: { 'band-row': { biceps: 0.25 } },
    });
    expect(trainingPreferencesSchema.parse(chosen)).toEqual(chosen);
  });

  it.each([
    ['a preference nobody defined', { equipment: { band: 'love' } }],
    ['an equipment nobody has', { equipment: { barbell: 'prefer' } }],
    [
      'sets per exposure beyond the technical limit',
      { setsPerExposure: { mode: 'fixed', byKind: { compound: 11 } } },
    ],
    ['no sets at all', { setsPerExposure: { mode: 'fixed', byKind: { compound: 0 } } }],
    ['fixed sets without numbers', { setsPerExposure: { mode: 'fixed' } }],
    ['a negative revision', { revision: -1 }],
    ['a muscle weight above 1', { muscleWeights: { x: { biceps: 1.5 } } }],
    ['a weekly maximum of a muscle nobody has', { volumeOverrides: { wings: 4 } }],
    ['an unknown field', { mood: 'good' }],
  ])('refuse %s', (_, patch) => {
    expect(trainingPreferencesSchema.safeParse({ ...defaultPreferences(), ...patch }).success).toBe(
      false,
    );
  });
});

describe('T74 how much an exercise is liked', () => {
  const goblet = byId['goblet-squat']!; // a dumbbell
  const bandSquat = byId['band-squat']!;

  it('is nothing by default', () => {
    expect(preferenceScore(goblet, prefs())).toBe(0);
  });

  it('follows the equipment: +1 preferred, -1 avoided', () => {
    expect(preferenceScore(bandSquat, prefs({ equipment: { band: 'prefer' } }))).toBe(1);
    expect(preferenceScore(bandSquat, prefs({ equipment: { band: 'avoid' } }))).toBe(-1);
    expect(preferenceScore(goblet, prefs({ equipment: { band: 'prefer' } }))).toBe(0);
    expect(preferenceScore(bandSquat, prefs({ equipment: { band: 'neutral' } }))).toBe(0);
  });

  it('follows the exercise itself — +2 chosen, -2 avoided — before the equipment', () => {
    expect(preferenceScore(goblet, prefs({ exercises: { 'goblet-squat': 'prefer' } }))).toBe(2);
    expect(preferenceScore(goblet, prefs({ exercises: { 'goblet-squat': 'avoid' } }))).toBe(-2);
    expect(
      preferenceScore(
        goblet,
        prefs({ exercises: { 'goblet-squat': 'prefer' }, equipment: { dumbbell: 'avoid' } }),
      ),
    ).toBe(2);
    expect(
      preferenceScore(
        goblet,
        prefs({ exercises: { 'goblet-squat': 'neutral' }, equipment: { dumbbell: 'avoid' } }),
      ),
    ).toBe(-1);
  });
});

describe('T73 near-equivalent exercises', () => {
  it('are the same slot, counted alike, training the same muscles, each a good substitute for the other', () => {
    expect(nearEquivalent(byId['goblet-squat']!, byId['band-squat']!, realSlotOf)).toBe(true);
    expect(nearEquivalent(byId['goblet-squat']!, byId['dumbbell-squat']!, realSlotOf)).toBe(true);
    expect(nearEquivalent(byId['band-squat']!, byId['dumbbell-squat']!, realSlotOf)).toBe(true);
    expect(nearEquivalent(byId['goblet-squat']!, byId['goblet-squat']!, realSlotOf)).toBe(true);
  });

  it('are not a movement that only looks similar', () => {
    // Different muscles, a held squat counted in seconds, a seated isolation, another slot.
    expect(nearEquivalent(byId['goblet-squat']!, byId['wall-sit']!, realSlotOf)).toBe(false);
    expect(nearEquivalent(byId['goblet-squat']!, byId['band-leg-extension']!, realSlotOf)).toBe(
      false,
    );
    expect(nearEquivalent(byId['goblet-squat']!, byId['push-up']!, realSlotOf)).toBe(false);
    expect(nearEquivalent(byId['goblet-squat']!, byId['band-leg-press']!, realSlotOf)).toBe(false);
  });

  it('are what the catalogue says they are, whatever the numbers think', () => {
    const a = exercise({ id: 'a', equivalenceGroup: 'press' });
    const b = exercise({
      id: 'b',
      equivalenceGroup: 'press',
      movementPattern: 'Pull',
      primaryMuscles: ['back'],
    });
    expect(nearEquivalent(a, b, new Map())).toBe(true);
    expect(nearEquivalent(a, exercise({ id: 'c', equivalenceGroup: 'other' }), new Map())).toBe(
      false,
    );
    expect(nearEquivalent(exercise({ id: 'c' }), exercise({ id: 'd' }), new Map())).toBe(false);
  });

  it('need the threshold to be met in both directions', () => {
    const s = slot({ id: 'one', exerciseIds: ['a', 'b'] });
    const slotOf = slotByExercise([s]);
    const a = exercise({ id: 'a', primaryMuscles: ['quads', 'glutes'] });
    const b = exercise({ id: 'b', primaryMuscles: ['quads', 'glutes'], stanceMechanics: 'Seated' });
    // b is a poorer replacement for a (no bilateral bonus) than a is for b? Both are scored; a cut-off above both fails.
    expect(nearEquivalent(a, b, slotOf, 1)).toBe(true);
    expect(nearEquivalent(a, b, slotOf, 200)).toBe(false);
    const c = exercise({ id: 'c', primaryMuscles: ['quads', 'glutes'], forceProfile: 'Isometric' });
    expect(
      nearEquivalent(a, c, slotByExercise([slot({ id: 'one', exerciseIds: ['a', 'c'] })]), 1),
    ).toBe(false);
  });
});
