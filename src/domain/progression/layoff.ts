import { LAYOFF_FROM_DAYS, PROGRESSION_CONFIG } from '../config/training';
import { daysBetween } from '../time/trainingDate';

export type LayoffTier = 'none' | 'short' | 'medium' | 'long';

export interface LayoffState {
  tier: LayoffTier;
  /** Days since the last session; null before the first one. */
  gapDays: number | null;
  /**
   * Within the first sessions after a layoff of the long tier: they run at
   * the intro RIR before progression restarts (SPEC §6.3).
   */
  recalibrating: boolean;
}

export function tierOf(gapDays: number, thresholds = LAYOFF_FROM_DAYS): LayoffTier {
  if (gapDays >= thresholds.long) return 'long';
  if (gapDays >= thresholds.medium) return 'medium';
  if (gapDays >= thresholds.short) return 'short';
  return 'none';
}

/**
 * Where the person stands after time off, SPEC §6.3. Breaks are certain
 * here, not hypothetical, and the app must never punish them — so the
 * tiers only ever make the next session lighter or the same, never harder.
 *
 * `sessionDates` are the training dates of completed sessions, any order.
 */
export function layoffState(
  sessionDates: readonly string[],
  asOf: string,
  thresholds = LAYOFF_FROM_DAYS,
  cfg = PROGRESSION_CONFIG,
): LayoffState {
  const dates = [...new Set(sessionDates)].filter((d) => d <= asOf).sort();
  if (dates.length === 0) return { tier: 'none', gapDays: null, recalibrating: false };

  const gapDays = daysBetween(dates[dates.length - 1]!, asOf);
  const tier = tierOf(gapDays, thresholds);
  if (tier === 'long') return { tier, gapDays, recalibrating: true };

  let sinceLongBreak = Infinity;
  for (let i = dates.length - 1; i > 0; i -= 1) {
    if (daysBetween(dates[i - 1]!, dates[i]!) >= thresholds.long) {
      sinceLongBreak = dates.length - i;
      break;
    }
  }
  return { tier, gapDays, recalibrating: sinceLongBreak < cfg.recalibrationSessions };
}
