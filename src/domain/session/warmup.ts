import type { MedicalProfile } from '../types';

/**
 * The general warm-up before the first set: a short checklist done at
 * one's own pace, upper body first, then hips, spine and legs. Every move
 * is bilateral, unloaded and free of twisting under load, so it stays
 * inside the knee's hard exclusions. The reverse lunge is single-leg
 * work, so it waits for the physiotherapist like the engine does.
 */
export type WarmupMoveId =
  | 'arm-circles'
  | 'arm-swings'
  | 'shoulder-rolls'
  | 'hip-circles'
  | 'hip-hinge'
  | 'side-bends'
  | 'cat-cow'
  | 'chair-squat'
  | 'reverse-lunge'
  | 'calf-raises';

interface WarmupMove {
  id: WarmupMoveId;
  /** Single-leg work: only once the physio has signed off (SPEC conservative mode). */
  singleLeg?: boolean;
}

const MOVES: readonly WarmupMove[] = [
  { id: 'arm-circles' },
  { id: 'arm-swings' },
  { id: 'shoulder-rolls' },
  { id: 'hip-circles' },
  { id: 'hip-hinge' },
  { id: 'side-bends' },
  { id: 'cat-cow' },
  { id: 'chair-squat' },
  { id: 'reverse-lunge', singleLeg: true },
  { id: 'calf-raises' },
];

/** The checklist for this person, in order. */
export function warmupMoves(profile: MedicalProfile): WarmupMoveId[] {
  const singleLegAllowed = profile.knee === null || profile.knee.physioApproved;
  return MOVES.filter((m) => !m.singleLeg || singleLegAllowed).map((m) => m.id);
}
