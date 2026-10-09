/**
 * The volume lever (engine v2, 13 §19, 12 §5.5, D32). The engine does not raise
 * or lower the weekly volume by itself; it notices — a muscle that has been
 * trained for a month and whose key lifts stand still while it recovers well
 * could take more; one that is sore too often should take less — and proposes
 * a new weekly maximum for the person to accept. Accepted, it becomes
 * `TrainingPreferences.volumeOverrides` and a new policy version.
 */

import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { AUTOREGULATION_CONFIG, TRAINING_CONFIG, VOLUME_LEVER_CONFIG } from '../config/training';
import type { HistoryIndex } from '../history';
import type { FatigueSignal } from '../plan/reasons';
import type { DailyReadiness } from '../plan/types';
import type { Assessed } from '../progression/assessed';
import { stalledRun } from '../progression/stall';
import type { ResistanceModel } from '../resistance/types';
import { addDays, daysBetween } from '../time/trainingDate';
import type { MuscleGroup } from '../types';
import { maxDirectSets } from './weekly';

export type LeverReason = 'STALLED_WELL_RECOVERED' | 'RECOVERY_LOW' | 'FREQUENT_SORENESS';

export interface VolumeCard {
  muscle: MuscleGroup;
  change: 'increase' | 'decrease';
  fromMax: number;
  toMax: number;
  reasons: LeverReason[];
}

export interface LeverInput {
  asOf: string;
  idx: Pick<HistoryIndex, 'muscleDay'>;
  /** The key (compound) exercises that train each muscle as a primary one, with their histories. */
  keyExercises: Partial<
    Record<MuscleGroup, readonly { history: readonly Assessed[]; model: ResistanceModel }[]>
  >;
  daily: readonly DailyReadiness[];
  signals: readonly FatigueSignal[];
  /** What the person set before, per muscle (`volumeOverrides`). */
  overrides?: Partial<Record<MuscleGroup, number>>;
  cfg?: typeof VOLUME_LEVER_CONFIG;
}

/** Days a muscle has been trained without a break of a week or more, up to `asOf`; 0 if it is not trained now. */
function trainingStretchDays(
  idx: Pick<HistoryIndex, 'muscleDay'>,
  muscle: MuscleGroup,
  asOf: string,
): number {
  const days = [...idx.muscleDay]
    .filter(([date, work]) => date <= asOf && work[muscle].certain + work[muscle].uncertain > 0)
    .map(([date]) => date)
    .sort()
    .reverse();
  if (days.length === 0 || daysBetween(days[0]!, asOf) >= 8) return 0;
  let first = days[0]!;
  for (const date of days.slice(1)) {
    if (daysBetween(date, first) >= 8) break;
    first = date;
  }
  return daysBetween(first, asOf);
}

const sorenessDays = (
  daily: readonly DailyReadiness[],
  muscle: MuscleGroup,
  from: string,
  asOf: string,
  level: number,
) =>
  new Set(
    daily
      .filter((d) => d.date >= from && d.date <= asOf && (d.soreness?.[muscle] ?? 0) >= level)
      .map((d) => d.date),
  ).size;

export function volumeRecommendation(input: LeverInput): VolumeCard[] {
  const cfg = input.cfg ?? VOLUME_LEVER_CONFIG;
  const level = AUTOREGULATION_CONFIG.highSorenessLevel;
  const recoveryLow = input.signals.includes('RECOVERY_LOW');
  const cards: VolumeCard[] = [];

  for (const muscle of MUSCLE_GROUPS) {
    const stretch = trainingStretchDays(input.idx, muscle, input.asOf);
    if (stretch === 0) continue;
    const from = input.overrides?.[muscle] ?? maxDirectSets(muscle);
    const soreRecently = sorenessDays(
      input.daily,
      muscle,
      addDays(input.asOf, -(cfg.soreWindowDays - 1)),
      input.asOf,
      level,
    );
    const reasons: LeverReason[] = [];
    if (recoveryLow) reasons.push('RECOVERY_LOW');
    if (soreRecently >= cfg.soreDays) reasons.push('FREQUENT_SORENESS');

    if (reasons.length > 0) {
      const to = Math.max(
        TRAINING_CONFIG.weeklyWorkingSetsPerMuscle.min,
        Math.round(from * (1 - cfg.change)),
      );
      if (to < from) cards.push({ muscle, change: 'decrease', fromMax: from, toMax: to, reasons });
      continue;
    }

    const keys = input.keyExercises[muscle] ?? [];
    const standing =
      keys.length > 0 && keys.every((k) => stalledRun(k.history, k.model) >= cfg.stalledExposures);
    const sore =
      sorenessDays(
        input.daily,
        muscle,
        addDays(input.asOf, -(cfg.noSorenessDays - 1)),
        input.asOf,
        level,
      ) > 0;
    if (stretch >= cfg.minTrainingDays && standing && !sore) {
      const to = Math.min(cfg.ceiling, Math.ceil(from * (1 + cfg.change)));
      if (to > from) {
        cards.push({
          muscle,
          change: 'increase',
          fromMax: from,
          toMax: to,
          reasons: ['STALLED_WELL_RECOVERED'],
        });
      }
    }
  }
  return cards;
}
