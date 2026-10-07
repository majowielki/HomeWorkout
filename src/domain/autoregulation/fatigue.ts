import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { AUTOREGULATION_CONFIG, PROGRESSION_CONFIG } from '../config/training';
import type { FatigueSignal } from '../plan/reasons';
import type { DailyReadiness, Slot } from '../plan/types';
import { amountOf, exposuresOf, type HistorySession } from '../progression/history';
import { ladderFor } from '../progression/ladder';
import { loadKindOf } from '../progression/load';
import { unitOf } from '../progression/prescribe';
import { addDays, hasStreakEnding } from '../time/trainingDate';
import type { Exercise } from '../types';

export interface FatigueInput {
  asOf: string;
  /** Completed sessions, oldest first. */
  sessions: readonly HistorySession[];
  catalog: Readonly<Record<string, Exercise>>;
  slotOf: ReadonlyMap<string, Slot>;
  daily: readonly DailyReadiness[];
}

/**
 * Overload signals, SPEC §6.1, from the logs alone:
 *
 * - FATIGUE_HIGH: RIR 0 on a compound lift in each of the last two sessions
 *   that had one
 * - PERFORMANCE_DROP: an exercise that, at the same load, did fewer reps
 *   (or seconds) in each of its last two exposures. A lower load is not a
 *   drop — the engine itself asks for one after a layoff or a regression.
 * - RECOVERY_LOW: under 6 h of sleep three days running, or one muscle at
 *   DOMS 4+ on four daily logs running (more than 72 h)
 *
 * Only recent sessions count, so an old bad week does not haunt the plan.
 */
export function fatigueSignals(input: FatigueInput, cfg = AUTOREGULATION_CONFIG): FatigueSignal[] {
  const from = addDays(input.asOf, -(cfg.signalWindowDays - 1));
  const recent = input.sessions.filter((s) => s.date >= from && s.date <= input.asOf);
  const out: FatigueSignal[] = [];
  if (grindingCompounds(recent, input.slotOf)) out.push('FATIGUE_HIGH');
  if (performanceDrop(recent, input)) out.push('PERFORMANCE_DROP');
  if (recoveryLow(input.daily, input.asOf, cfg)) out.push('RECOVERY_LOW');
  return out;
}

function grindingCompounds(
  sessions: readonly HistorySession[],
  slotOf: ReadonlyMap<string, Slot>,
): boolean {
  const compound = (id: string) => slotOf.get(id)?.kind === 'compound';
  const withCompounds = sessions
    .map((s) => s.sets.filter((set) => !set.isWarmup && compound(set.exerciseId)))
    .filter((sets) => sets.length > 0);
  const lastTwo = withCompounds.slice(-2);
  return lastTwo.length === 2 && lastTwo.every((sets) => sets.some((set) => set.rir === 0));
}

function performanceDrop(sessions: readonly HistorySession[], input: FatigueInput): boolean {
  const ids = new Set(sessions.flatMap((s) => s.sets.map((set) => set.exerciseId)));
  for (const id of ids) {
    const exercise = input.catalog[id];
    const slot = input.slotOf.get(id);
    if (!exercise || !slot) continue;
    const ladder = ladderFor(exercise, slot);
    const unit = unitOf(exercise);
    const last3 = exposuresOf(
      id,
      sessions,
      ladder,
      unit,
      loadKindOf(exercise) === 'band' && PROGRESSION_CONFIG.requireBandWarmup,
    ).slice(-3);
    if (last3.length < 3) continue;
    const ranks = new Set(last3.map((e) => ladder.rank(e.load)));
    if (ranks.size !== 1) continue;
    const best = last3.map((e) => Math.max(...e.sets.map((s) => amountOf(s, unit)!)));
    if (best[0]! > best[1]! && best[1]! > best[2]!) return true;
  }
  return false;
}

function recoveryLow(
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

/** SPEC §6.1: two or more different signals at once. */
export function warrantsReactiveDeload(
  signals: readonly FatigueSignal[],
  cfg = AUTOREGULATION_CONFIG,
): boolean {
  return new Set(signals).size >= cfg.reactiveDeloadSignals;
}
