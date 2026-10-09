/**
 * Medical screening per joint (engine, 05 §12, 13 §10).
 *
 * Today only the knee is screened, by `screenExercise`. A new exercise or
 * implement loads other joints too — the shoulder, the lower back, the wrist —
 * and the engine must not read the absence of a rule as the absence of a risk.
 * This is the *contract* for that, not new medical rules: a screener says
 * which joint it is about, which facts an exercise must be classified with for
 * it to be judged, whether the exercise loads the joint, and what it excludes.
 *
 * Rules for the other joints are data and a screener, added later with a
 * physiotherapist. Until then, an exercise that loads a joint a profile
 * describes, and is not classified for it, is not allowed for that profile.
 */

import { type ExclusionCode, screenExercise } from '../exercises/screen';
import type { Exercise, JointId, MedicalProfile as KneeMedicalProfile } from '../types';
import { loadsJoint } from '../catalog/attributes';

/** What the person's profile says, per joint; a joint that is absent is a joint nobody described. */
export interface MedicalProfile {
  joints: Partial<Record<JointId, unknown>>;
}

/** The profile of v1 (the knee only) read as a v2 profile, unchanged. */
export function medicalProfile(profile: KneeMedicalProfile): MedicalProfile {
  return { joints: profile.knee === null ? {} : { knee: profile.knee } };
}

export type ScreenCode = ExclusionCode | 'MISSING_CLASSIFICATION';

export interface Screener {
  joint: JointId;
  /** Facts about the exercise this joint's rules need; an exercise without one cannot be judged. */
  requiredFields: readonly string[];
  /** Whether the exercise loads the joint; `unknown` is neither a yes nor a no. */
  loads(exercise: Exercise): boolean | 'unknown';
  /** Why the exercise is out for what the profile says about this joint; empty means allowed. */
  screen(exercise: Exercise, joint: unknown): ScreenCode[];
}

/** The knee: exactly the rules of `screenExercise`, the classification fields it has always required. */
export const kneeScreener: Screener = {
  joint: 'knee',
  requiredFields: [
    'loadsKnee',
    'planesOfMotion',
    'stanceMechanics',
    'forceProfile',
    'isClosedKineticChain',
    'provokesValgusVarus',
    'highAnteriorTibialShear',
  ],
  loads: (exercise) => loadsJoint(exercise, 'knee'),
  screen: (exercise, knee) =>
    screenExercise(exercise, { knee: knee as KneeMedicalProfile['knee'] }),
};

export const SCREENERS: readonly Screener[] = [kneeScreener];

export interface ScreenResult {
  codes: ScreenCode[];
  /** Per joint, the facts the exercise lacks. */
  missing: { joint: JointId; fields: string[] }[];
}

/**
 * Every screener whose joint the profile describes is asked. If the exercise
 * loads that joint — or nobody has said whether it does — and lacks a fact the
 * screener needs, the exercise is `MISSING_CLASSIFICATION`: not allowed, and
 * the profile is not asked to guess.
 */
export function screenAll(
  exercise: Exercise,
  profile: MedicalProfile,
  screeners: readonly Screener[] = SCREENERS,
): ScreenResult {
  const codes: ScreenCode[] = [];
  const missing: ScreenResult['missing'] = [];
  for (const screener of screeners) {
    const described = profile.joints[screener.joint];
    if (described === undefined || described === null) continue;
    const loads = screener.loads(exercise);
    if (loads === false) continue;
    const absent =
      loads === 'unknown'
        ? ['jointLoading']
        : screener.requiredFields.filter(
            (f) => (exercise as unknown as Record<string, unknown>)[f] == null,
          );
    if (absent.length > 0) {
      missing.push({ joint: screener.joint, fields: absent });
      if (!codes.includes('MISSING_CLASSIFICATION')) codes.push('MISSING_CLASSIFICATION');
      continue;
    }
    for (const code of screener.screen(exercise, described)) {
      if (!codes.includes(code)) codes.push(code);
    }
  }
  return { codes, missing };
}
