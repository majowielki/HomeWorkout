/**
 * Engine v2, P1 (05 §12, 13 §10): the screener registry. The knee behaves
 * exactly as before; a joint nobody has written rules for is not read as safe.
 */
import exercisesJson from '@data/exercises.json';
import { exerciseCatalogueSchema } from '@data/exercises.schema';

import { screenExercise } from '../exercises/screen';
import {
  kneeScreener,
  medicalProfileV2,
  type Screener,
  screenAll,
  SCREENERS,
} from '../medical/screeners';
import type { Exercise } from '../types';
import { CONSERVATIVE, exercise, HARD_ONLY } from './fixtures';

const real = exerciseCatalogueSchema.parse(exercisesJson).exercises as Exercise[];

describe('the knee through the registry', () => {
  it('is the only screener there is for now', () => {
    expect(SCREENERS).toEqual([kneeScreener]);
  });

  it('reads a v1 profile as a v2 one without changing it', () => {
    expect(medicalProfileV2({ knee: null })).toEqual({ joints: {} });
    expect(medicalProfileV2(HARD_ONLY)).toEqual({ joints: { knee: HARD_ONLY.knee } });
  });

  it.each([
    ['no profile', { knee: null }],
    ['the conservative knee', CONSERVATIVE],
    ['the knee with hard exclusions only', HARD_ONLY],
  ])('excludes exactly what screenExercise excludes — %s, all %d exercises', (_, profile) => {
    for (const e of real) {
      const result = screenAll(e, medicalProfileV2(profile));
      expect({ id: e.id, codes: result.codes }).toEqual({
        id: e.id,
        codes: screenExercise(e, profile),
      });
      expect(result.missing).toEqual([]);
    }
  });

  it('does not ask about the knee when the profile does not describe one', () => {
    const squat = exercise({ loadsKnee: true, planesOfMotion: ['Frontal'] });
    expect(screenAll(squat, { joints: {} }).codes).toEqual([]);
  });

  it('does not judge an exercise that does not load the knee', () => {
    const raise = exercise({ loadsKnee: false, planesOfMotion: ['Frontal'] });
    expect(screenAll(raise, medicalProfileV2(CONSERVATIVE))).toEqual({ codes: [], missing: [] });
  });

  it('will not call an exercise safe for the knee while a fact about it is missing', () => {
    const broken = {
      ...exercise({ loadsKnee: true }),
      isClosedKineticChain: undefined,
    } as unknown as Exercise;
    expect(screenAll(broken, medicalProfileV2(HARD_ONLY))).toEqual({
      codes: ['MISSING_CLASSIFICATION'],
      missing: [{ joint: 'knee', fields: ['isClosedKineticChain'] }],
    });
  });
});

describe('a joint with a screener of its own', () => {
  const overheadLoaded = (e: Exercise) =>
    (e as Exercise & { overheadLoaded?: boolean }).overheadLoaded;
  const shoulder: Screener = {
    joint: 'shoulder',
    requiredFields: ['overheadLoaded'],
    loads: (e) => e.jointLoading?.shoulder ?? 'unknown',
    screen: (e) => (overheadLoaded(e) ? ['KNEE_PLYOMETRIC'] : []),
  };
  const withShoulder = { joints: { shoulder: { impingement: true } } };
  const press = (patch: Partial<Exercise> & { overheadLoaded?: boolean } = {}) =>
    ({ ...exercise({ jointLoading: { shoulder: true } }), ...patch }) as Exercise;

  it('T-screeners judges an exercise that loads the joint and is classified for it', () => {
    expect(screenAll(press({ overheadLoaded: true } as never), withShoulder, [shoulder])).toEqual({
      codes: ['KNEE_PLYOMETRIC'],
      missing: [],
    });
    expect(
      screenAll(press({ overheadLoaded: false } as never), withShoulder, [shoulder]).codes,
    ).toEqual([]);
  });

  it('refuses one that loads the joint and lacks a fact the rules need', () => {
    expect(screenAll(press(), withShoulder, [shoulder])).toEqual({
      codes: ['MISSING_CLASSIFICATION'],
      missing: [{ joint: 'shoulder', fields: ['overheadLoaded'] }],
    });
  });

  it('refuses one nobody has said anything about — unknown is not "no"', () => {
    const unknown = exercise({});
    expect(screenAll(unknown, withShoulder, [shoulder])).toEqual({
      codes: ['MISSING_CLASSIFICATION'],
      missing: [{ joint: 'shoulder', fields: ['jointLoading'] }],
    });
  });

  it('leaves alone an exercise that is known not to load it, and a profile that does not describe it', () => {
    const calf = exercise({ jointLoading: { shoulder: false } });
    expect(screenAll(calf, withShoulder, [shoulder])).toEqual({ codes: [], missing: [] });
    expect(screenAll(press(), { joints: {} }, [shoulder])).toEqual({ codes: [], missing: [] });
    expect(screenAll(press(), { joints: { shoulder: null } }, [shoulder])).toEqual({
      codes: [],
      missing: [],
    });
  });

  it('reports one missing classification however many joints lack it, and each code once', () => {
    const wrist: Screener = {
      ...shoulder,
      joint: 'wrist',
      loads: () => true,
      requiredFields: ['wristFact'],
    };
    const both = screenAll(press(), { joints: { shoulder: {}, wrist: {} } }, [shoulder, wrist]);
    expect(both.codes).toEqual(['MISSING_CLASSIFICATION']);
    expect(both.missing.map((m) => m.joint)).toEqual(['shoulder', 'wrist']);
    const twice: Screener = { ...shoulder, joint: 'elbow', loads: () => true, requiredFields: [] };
    const same = screenAll(
      press({ overheadLoaded: true } as never),
      { joints: { shoulder: {}, elbow: {} } },
      [shoulder, twice],
    );
    expect(same.codes).toEqual(['KNEE_PLYOMETRIC']);
  });

  it('works next to the knee', () => {
    const lunge = exercise({
      loadsKnee: true,
      stanceMechanics: 'UnilateralUnsupported',
      jointLoading: { shoulder: false },
    });
    const result = screenAll(lunge, { joints: { knee: HARD_ONLY.knee, shoulder: {} } }, [
      kneeScreener,
      shoulder,
    ]);
    expect(result.codes).toContain('KNEE_UNILATERAL_UNSUPPORTED');
    expect(result.missing).toEqual([]);
  });
});
