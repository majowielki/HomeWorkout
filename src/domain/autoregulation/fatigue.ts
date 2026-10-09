import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { AUTOREGULATION_CONFIG } from '../config/training';
import type { DailyReadiness } from '../plan/types';
import { hasStreakEnding } from '../time/trainingDate';

export function recoveryLow(
  daily: readonly DailyReadiness[],
  asOf: string,
  cfg: typeof AUTOREGULATION_CONFIG,
): boolean {
  const lowSleep = new Set(
    daily
      .filter((d) => d.sleepHours !== null && d.sleepHours < cfg.lowSleepHours)
      .map((d) => d.date),
  );
  if (hasStreakEnding(lowSleep, asOf, cfg.lowSleepStreakDays)) return true;
  return MUSCLE_GROUPS.some((muscle) => {
    const sore = new Set(
      daily.filter((d) => (d.soreness?.[muscle] ?? 0) >= cfg.highSorenessLevel).map((d) => d.date),
    );
    return hasStreakEnding(sore, asOf, cfg.sorenessStreakDays);
  });
}
