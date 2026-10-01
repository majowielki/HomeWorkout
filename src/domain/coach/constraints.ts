import type { KneeProfile } from '../types';
import type { ConstraintCode } from './vocabulary';

/**
 * The knee as limits, not as history. A model that is told "no frontal-plane
 * work under load" can respect it; a model that is told about the ligaments
 * behind it has been handed a diagnosis it has no use for
 * (AI-INTEGRACJA §4.8). The wording follows `screenExercise`.
 */
export function kneeConstraints(knee: KneeProfile | null): ConstraintCode[] {
  if (!knee) return [];
  const out: ConstraintCode[] = [];
  if (knee.missingCollaterals || knee.varusThrust) out.push('knee_no_frontal_plane_under_load');
  if (knee.aclReconstructed) out.push('knee_limit_anterior_shear');
  if (!knee.physioApproved) out.push('knee_bilateral_only_until_physio');
  return out;
}
