import type { PlannedLoad, Side } from '../types';
import type { LoadLadder } from './ladder';

/** One logged set as the engine reads history. */
export interface HistorySet {
  exerciseId: string;
  isWarmup: boolean;
  reps: number | null;
  timeSec: number | null;
  rir: number | null;
  load: PlannedLoad;
  /** One side of a one-sided exercise (`sides: 'perSet'`); absent or null for two-sided work. */
  side?: Side | null;
}

/** One completed session: its training date and every set in the order performed. */
export interface HistorySession {
  date: string;
  sets: HistorySet[];
}

export type Unit = 'reps' | 'sec';

/** How much of the target one set achieved, or null when the field was left empty. */
export function amountOf(set: HistorySet, unit: Unit): number | null {
  return unit === 'sec' ? set.timeSec : set.reps;
}

/** The working sets of one session that progression may compare, at their heaviest load. */
export interface Exposure {
  date: string;
  load: PlannedLoad;
  /** Working sets at `load`, in order; each has an amount. */
  sets: HistorySet[];
  /** The band's first working set came without a warm-up and was set aside (SPEC §5.6). */
  warmupMissing: boolean;
}

/**
 * Every session that included this exercise, as progression sees it,
 * oldest first.
 *
 * - Warm-ups are not results.
 * - With a band, a first working set that no warm-up preceded is set
 *   aside (`WARMUP_MISSING`): the Mullins effect makes it read stronger
 *   than the band really is.
 * - Only sets at the session's heaviest load are compared; a lighter
 *   back-off set says nothing about whether the top load was mastered.
 * - A session left with nothing comparable is not an exposure.
 */
export function exposuresOf(
  exerciseId: string,
  sessions: readonly HistorySession[],
  ladder: LoadLadder,
  unit: Unit,
  requireBandWarmup: boolean,
): Exposure[] {
  const out: Exposure[] = [];
  for (const session of sessions) {
    const sets = session.sets.filter((s) => s.exerciseId === exerciseId);
    let working = sets.filter((s) => !s.isWarmup);
    const warmupMissing = requireBandWarmup && sets.length > 0 && !sets[0]!.isWarmup;
    if (warmupMissing) working = working.slice(1);

    const ranked = working.filter(
      (s) => ladder.rank(s.load) !== null && amountOf(s, unit) !== null,
    );
    if (ranked.length === 0) continue;
    const top = Math.max(...ranked.map((s) => ladder.rank(s.load)!));
    const atTop = ranked.filter((s) => ladder.rank(s.load) === top);
    out.push({ date: session.date, load: atTop[0]!.load, sets: atTop, warmupMissing });
  }
  return out;
}
