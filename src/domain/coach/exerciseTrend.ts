import { COACH_CONFIG } from '../config/training';
import type { PlannedLoad } from '../types';
import type { TrendVerdict } from './vocabulary';

/** One working set as the trend sees it. Warm-ups never get here. */
export interface TrendSet {
  load: PlannedLoad;
  reps: number | null;
  timeSec: number | null;
}

export interface TrendResult {
  verdict: TrendVerdict;
  /** Sessions with at least one working set of this exercise. */
  sessions: number;
}

const unitOf = (set: TrendSet) => (set.reps === null && set.timeSec !== null ? 'sec' : 'reps');
const amountOf = (set: TrendSet) => (unitOf(set) === 'sec' ? set.timeSec! : (set.reps ?? 0));

/** Loads are only ordered against loads of the same kind: a band is not a dumbbell. */
function comparable(a: TrendSet, b: TrendSet): boolean {
  if (unitOf(a) !== unitOf(b) || a.load.kind !== b.load.kind) return false;
  if (a.load.kind === 'dumbbell' && b.load.kind === 'dumbbell') return a.load.mode === b.load.mode;
  if (a.load.kind === 'band' && b.load.kind === 'band') return a.load.bandId === b.load.bandId;
  return true;
}

/** Heavier is higher; a band further out is heavier (SPEC §5.4); bodyweight has one step. */
function rank(set: TrendSet): number {
  if (set.load.kind === 'dumbbell') return set.load.kg;
  if (set.load.kind === 'band') return set.load.position;
  return 0;
}

/** Sets of one session come with one load in practice; if not, the hardest comparable set wins. */
function bestSet(sets: readonly TrendSet[]): TrendSet {
  return sets.reduce((best, set) => {
    if (!comparable(best, set)) return best;
    if (rank(set) !== rank(best)) return rank(set) > rank(best) ? set : best;
    return amountOf(set) > amountOf(best) ? set : best;
  });
}

/**
 * Did the lifter hold, gain or lose strength on one exercise?
 *
 * Compares the best working set of the latest session with that of the
 * earliest session that used a comparable load. Load first, then reps: a
 * band moved one position out for two reps fewer is progress (SPEC §5.4).
 * With the load unchanged, a difference within the tolerance is
 * "maintained": in a deficit, holding the numbers is the result. This is
 * the code-computed form of the strength-retention metric (PLAN §7); the
 * model only comments on it.
 *
 * `sessions` are oldest first.
 */
export function exerciseTrend(
  sessions: readonly (readonly TrendSet[])[],
  cfg = COACH_CONFIG,
): TrendResult {
  const bests = sessions.filter((s) => s.length > 0).map(bestSet);
  if (bests.length < 2) return { verdict: 'insufficient_data', sessions: bests.length };

  const latest = bests[bests.length - 1]!;
  const baseline = bests.slice(0, -1).find((set) => comparable(set, latest));
  if (!baseline) return { verdict: 'not_comparable', sessions: bests.length };

  const loadDelta = rank(latest) - rank(baseline);
  if (loadDelta !== 0) {
    return { verdict: loadDelta > 0 ? 'improved' : 'declined', sessions: bests.length };
  }

  const tolerance = unitOf(latest) === 'sec' ? cfg.trendTimeToleranceSec : cfg.trendRepTolerance;
  const amountDelta = amountOf(latest) - amountOf(baseline);
  if (Math.abs(amountDelta) <= tolerance) return { verdict: 'maintained', sessions: bests.length };
  return { verdict: amountDelta > 0 ? 'improved' : 'declined', sessions: bests.length };
}
