import { SUBSTITUTE_CONFIG } from '../config/training';
import type { Exercise } from '../types';

export interface RankedSubstitute {
  exercise: Exercise;
  score: number;
}

/**
 * How good a replacement `candidate` is for `original`, SPEC §3.4:
 *
 *   50 × share of the original's primary muscles it also trains
 * + 30 if it is a hinge (the posterior chain protects the ACL)
 * + 20 if both feet stay down
 * + 10 if it is closed-chain
 * +  5 if it is the same movement pattern
 */
export function substituteScore(
  original: Exercise,
  candidate: Exercise,
  cfg = SUBSTITUTE_CONFIG,
): number {
  const shared = original.primaryMuscles.filter((m) => candidate.primaryMuscles.includes(m));
  const share = shared.length / original.primaryMuscles.length;
  return (
    cfg.sharedPrimaryWeight * share +
    (candidate.movementPattern === 'Hinge' ? cfg.hingeWeight : 0) +
    (candidate.stanceMechanics === 'Bilateral' ? cfg.bilateralWeight : 0) +
    (candidate.isClosedKineticChain ? cfg.closedChainWeight : 0) +
    (candidate.movementPattern === original.movementPattern ? cfg.samePatternWeight : 0)
  );
}

/**
 * Where replacements are looked for: the hand-picked `substituteIds` first,
 * then the other exercises of the same slot. Unknown ids, the original
 * itself and repeats are dropped.
 */
export function substituteCandidates(
  original: Exercise,
  catalog: Readonly<Record<string, Exercise>>,
  slotSiblingIds: readonly string[] = [],
): Exercise[] {
  const seen = new Set<string>([original.id]);
  const out: Exercise[] = [];
  for (const id of [...original.substituteIds, ...slotSiblingIds]) {
    const exercise = catalog[id];
    if (!exercise || seen.has(id)) continue;
    seen.add(id);
    out.push(exercise);
  }
  return out;
}

/**
 * Allowed candidates at or above the threshold, best first; ties keep the
 * order they came in. Empty means "no sensible replacement" — and the UI
 * says so rather than offering something that merely exists.
 */
export function rankSubstitutes(
  original: Exercise,
  candidates: readonly Exercise[],
  isAllowed: (exercise: Exercise) => boolean,
  cfg = SUBSTITUTE_CONFIG,
): RankedSubstitute[] {
  return candidates
    .filter((c) => c.id !== original.id && isAllowed(c))
    .map((exercise) => ({ exercise, score: substituteScore(original, exercise, cfg) }))
    .filter((r) => r.score >= cfg.threshold)
    .sort((a, b) => b.score - a.score);
}
