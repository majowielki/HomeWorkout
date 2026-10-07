import { PLANNER_CONFIG, type PlannerConfig, TRAINING_CONFIG } from '../config/training';
import { MUSCLE_GROUPS } from '../coach/vocabulary';
import type { HistorySession } from '../progression/history';
import { addDays } from '../time/trainingDate';
import type { Exercise, MuscleGroup } from '../types';
import { lastTrained } from './dayPlanner';
import { slotByExercise } from './eligibility';
import type { Slot } from './types';

/** A muscle that is still recovering, and the first day the planner may train it again. */
export interface MuscleRecovery {
  muscle: MuscleGroup;
  /** The last day it had working sets as a primary muscle. */
  lastWorked: string;
  readyOn: string;
}

/**
 * Which muscles rest after the work up to `asOf`, and until when — the
 * "time to recover" card once today's training is done. It is the
 * planner's own rule (SPEC §10.4, RECOVERING): a muscle with working sets
 * as a primary in the last `recoveryDays` days waits; light work at RIR 5
 * does not count. Soonest first, then in vocabulary order.
 */
export function recoveryOutlook(
  sessions: readonly HistorySession[],
  catalog: Readonly<Record<string, Exercise>>,
  slots: readonly Slot[],
  asOf: string,
  cfg: PlannerConfig = PLANNER_CONFIG,
  training = TRAINING_CONFIG,
): MuscleRecovery[] {
  const past = sessions.filter((s) => s.date <= asOf);
  const { lastPrimary } = lastTrained(past, catalog, slotByExercise(slots), training);
  const out: MuscleRecovery[] = [];
  for (const muscle of MUSCLE_GROUPS) {
    const lastWorked = lastPrimary[muscle];
    if (lastWorked === undefined) continue;
    const readyOn = addDays(lastWorked, cfg.recoveryDays + 1);
    if (readyOn > asOf) out.push({ muscle, lastWorked, readyOn });
  }
  return out.sort((a, b) => a.readyOn.localeCompare(b.readyOn));
}
