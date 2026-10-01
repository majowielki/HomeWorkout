import { COACH_CONFIG } from '../config/training';
import type { DatedValue } from '../metrics/series';
import { addDays, daysBetween } from '../time/trainingDate';
import type { SignalCode } from './vocabulary';

export interface SignalInput {
  /** The training date the summary is about, 'YYYY-MM-DD'. */
  asOf: string;
  /** Completed sessions ever, not only those in the window. */
  completedSessionCount: number;
  lastSessionDate: string | null;
  /** Hours slept, one value per logged day. */
  sleep: readonly DatedValue[];
}

/**
 * Facts the logs establish by themselves, as codes (SPEC §1.2). The model
 * is told them and may comment on them; it is never asked to work them out.
 *
 * This is the data-only part of SPEC §6.1 and §6.3. The rules engine
 * (M7) adds the performance signals and should take the layoff tiers from
 * here rather than restate the thresholds.
 */
export function deriveSignals(input: SignalInput, cfg = COACH_CONFIG): SignalCode[] {
  const out: SignalCode[] = [];

  if (input.completedSessionCount <= cfg.sparseHistoryMaxSessions) out.push('SPARSE_HISTORY');

  if (input.lastSessionDate !== null) {
    const gap = daysBetween(input.lastSessionDate, input.asOf);
    if (gap >= cfg.layoffFromDays.long) out.push('LAYOFF_LONG');
    else if (gap >= cfg.layoffFromDays.medium) out.push('LAYOFF_MEDIUM');
    else if (gap >= cfg.layoffFromDays.short) out.push('LAYOFF_SHORT');
  }

  if (hasLowSleepStreak(input.sleep, input.asOf, cfg)) out.push('SLEEP_LOW_STREAK');

  return out;
}

/**
 * Sleep under the threshold on `lowSleepStreakDays` consecutive days that
 * end today, or yesterday: tonight's sleep is logged tomorrow morning, and
 * an empty "today" must not hide a bad run.
 */
function hasLowSleepStreak(
  sleep: readonly DatedValue[],
  asOf: string,
  cfg: typeof COACH_CONFIG,
): boolean {
  const low = new Set(sleep.filter((s) => s.value < cfg.lowSleepHours).map((s) => s.date));
  return [asOf, addDays(asOf, -1)].some((end) =>
    Array.from({ length: cfg.lowSleepStreakDays }, (_, i) => addDays(end, -i)).every((d) =>
      low.has(d),
    ),
  );
}
