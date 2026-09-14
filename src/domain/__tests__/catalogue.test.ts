import catalogue from '../../../data/exercises.json';
import { exerciseCatalogueSchema } from '../../../data/exercises.schema';
import { screenExercise } from '../exercises/screen';
import type { MedicalProfile } from '../types';

/**
 * Runs the safety filter over the real catalogue and pins the result.
 *
 * Any change to data/exercises.json that alters which exercises are
 * excluded for this user's knee must be reflected here on purpose —
 * a silent tagging mistake is exactly what this test exists to catch.
 */

const { exercises } = exerciseCatalogueSchema.parse(catalogue);

const conservative: MedicalProfile = {
  knee: {
    side: 'right',
    missingCollaterals: true,
    aclReconstructed: true,
    varusThrust: true,
    physioApproved: false,
  },
};

const physioApproved: MedicalProfile = {
  knee: { ...conservative.knee!, physioApproved: true },
};

function excludedIds(profile: MedicalProfile): string[] {
  return exercises
    .filter((e) => screenExercise(e, profile).length > 0)
    .map((e) => e.id)
    .sort();
}

describe('catalogue under the conservative knee profile', () => {
  it('excludes exactly the expected exercises', () => {
    expect(excludedIds(conservative)).toEqual(
      [
        // permanently excluded
        'band-leg-extension',
        'lateral-lunge',
        'single-leg-rdl',
        'suitcase-carry',
        // held until physio sign-off
        'band-hip-extension',
        'reverse-lunge',
        'split-squat',
        'step-up',
      ].sort(),
    );
  });

  it('releases only the supported-unilateral work after physio sign-off', () => {
    expect(excludedIds(physioApproved)).toEqual(
      ['band-leg-extension', 'lateral-lunge', 'single-leg-rdl', 'suitcase-carry'].sort(),
    );
  });

  it('leaves enough bilateral lower-body work to build a full-body session', () => {
    const allowedLower = exercises.filter(
      (e) =>
        screenExercise(e, conservative).length === 0 &&
        e.loadsKnee &&
        (e.movementPattern === 'Squat' || e.movementPattern === 'Hinge'),
    );
    // Two squat-pattern and two hinge-pattern options is the floor for
    // alternating FBW A/B without repeating the same exercise every session.
    expect(allowedLower.filter((e) => e.movementPattern === 'Squat').length).toBeGreaterThanOrEqual(
      2,
    );
    expect(allowedLower.filter((e) => e.movementPattern === 'Hinge').length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('never excludes an exercise that does not load the knee', () => {
    for (const e of exercises) {
      if (!e.loadsKnee) {
        expect({ id: e.id, codes: screenExercise(e, conservative) }).toEqual({
          id: e.id,
          codes: [],
        });
      }
    }
  });

  it('keeps the bike available — it is the safest lower-body volume there is', () => {
    const bike = exercises.find((e) => e.id === 'stationary-bike')!;
    expect(screenExercise(bike, conservative)).toEqual([]);
  });
});

describe('catalogue integrity', () => {
  it('lists every substitute as an allowed or at least existing exercise', () => {
    const ids = new Set(exercises.map((e) => e.id));
    for (const e of exercises) {
      for (const sub of e.substituteIds) {
        expect(ids.has(sub)).toBe(true);
      }
    }
  });

  it('gives every excluded exercise at least one allowed substitute', () => {
    const allowed = new Set(
      exercises.filter((e) => screenExercise(e, conservative).length === 0).map((e) => e.id),
    );
    for (const e of exercises) {
      if (screenExercise(e, conservative).length > 0) {
        const hasSafeSub = e.substituteIds.some((s) => allowed.has(s));
        expect({ id: e.id, hasSafeSub }).toEqual({ id: e.id, hasSafeSub: true });
      }
    }
  });
});
