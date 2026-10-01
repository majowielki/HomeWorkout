import type { Exercise, MedicalProfile } from '../types';

/**
 * Why an exercise is not allowed for a given medical profile.
 *
 * Codes, not sentences: the UI maps them to Polish copy and the AI layer
 * receives them as structured facts instead of guessing intent.
 */
export type ExclusionCode =
  | 'KNEE_FRONTAL_PLANE'
  | 'KNEE_TRANSVERSE_PLANE'
  | 'KNEE_VALGUS_VARUS'
  | 'KNEE_UNILATERAL_UNSUPPORTED'
  | 'KNEE_UNILATERAL_PENDING_PHYSIO'
  | 'KNEE_PLYOMETRIC'
  | 'KNEE_OPEN_CHAIN_QUAD';

/**
 * Medical safety filter. Returns every reason an exercise is excluded;
 * an empty array means it is allowed.
 *
 * The single most important line here is the `loadsKnee` gate. The
 * research this derives from phrased its rules globally ("reject frontal
 * plane"), which read literally would also reject lateral raises, chest
 * flyes and every anti-rotation core exercise — movements that never touch
 * the knee. See Documents/PLAN.md §10.3.
 */
export function screenExercise(exercise: Exercise, profile: MedicalProfile): ExclusionCode[] {
  const knee = profile.knee;
  if (!knee) return [];
  if (!exercise.loadsKnee) return [];

  const out: ExclusionCode[] = [];

  if (knee.missingCollaterals || knee.varusThrust) {
    if (exercise.planesOfMotion.includes('Frontal')) out.push('KNEE_FRONTAL_PLANE');
    if (exercise.planesOfMotion.includes('Transverse')) out.push('KNEE_TRANSVERSE_PLANE');
    if (exercise.provokesValgusVarus) out.push('KNEE_VALGUS_VARUS');
    if (exercise.stanceMechanics === 'UnilateralUnsupported') {
      out.push('KNEE_UNILATERAL_UNSUPPORTED');
    }
  }

  if (exercise.forceProfile === 'Plyometric') out.push('KNEE_PLYOMETRIC');

  // Open-chain quad work: peak anterior tibial shear on the graft at 0-30°
  // of flexion, with no hamstring co-contraction to offset it.
  if (knee.aclReconstructed && !exercise.isClosedKineticChain && exercise.highAnteriorTibialShear) {
    out.push('KNEE_OPEN_CHAIN_QUAD');
  }

  // Conservative mode: until a physiotherapist has signed off, anything
  // that is not both feet planted is held back — split squats included.
  if (
    !knee.physioApproved &&
    exercise.stanceMechanics !== 'Bilateral' &&
    exercise.stanceMechanics !== 'Seated' &&
    exercise.stanceMechanics !== 'Supine' &&
    exercise.stanceMechanics !== 'Prone' &&
    !out.includes('KNEE_UNILATERAL_UNSUPPORTED')
  ) {
    out.push('KNEE_UNILATERAL_PENDING_PHYSIO');
  }

  return out;
}

export function isAllowed(exercise: Exercise, profile: MedicalProfile): boolean {
  return screenExercise(exercise, profile).length === 0;
}
