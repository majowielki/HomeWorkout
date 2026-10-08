import { loadPlannerSource, type PlannerSource } from '@/db/repositories/plannerSource';
import { getTrainingWeek } from '@/db/repositories/profile';
import { getCurrentBlock, type StoredBlock } from '@/db/repositories/trainingBlocks';
import { getActiveConstraints, getPlannedDays, getTrainedDates } from '@/db/repositories/weekPlan';
import { fatigueSignals } from '@/domain/autoregulation/fatigue';
import { WEEK_CONFIG } from '@/domain/config/training';
import { advanceBlock } from '@/domain/plan/block';
import type { PlanConstraint, TrainingWeek } from '@/domain/plan/constraints';
import { slotByExercise } from '@/domain/plan/eligibility';
import type { Slot } from '@/domain/plan/types';
import type { StoredDay, SyncInput } from '@/domain/plan/weekSync';
import { addDays } from '@/domain/time/trainingDate';
import { SLOTS } from './slots';

/** Everything the planner reads from the database, as plain data. */
export interface PlanningReads {
  source: PlannerSource;
  current: StoredBlock | null;
  constraints: readonly PlanConstraint[];
  week: TrainingWeek;
  stored: readonly StoredDay[];
  trainedDates: ReadonlySet<string>;
}

/**
 * The one way the engine's input is assembled — for the week, the extra
 * session and the coach's previews alike. Advancing a block here writes nothing.
 */
export function buildPlanningSnapshot(reads: PlanningReads, slots: readonly Slot[] = SLOTS) {
  const { source, current, constraints, week, stored, trainedDates } = reads;
  const { asOf, catalog } = source;
  const eligibility = { profile: source.profile, excludedIds: new Set(source.excludedIds) };
  const advance = advanceBlock(current?.state ?? null, {
    asOf,
    lastSessionDate: source.lastSessionDate,
    signals: fatigueSignals({
      asOf,
      sessions: source.sessions,
      catalog,
      slotOf: slotByExercise(slots),
      daily: source.daily,
    }),
    slots,
    catalog,
    eligibility,
  });
  const input: SyncInput = {
    ...source,
    slots,
    eligibility,
    block: advance.block,
    constraints,
    week,
    stored,
    trainedDates,
  };
  return { source, current, advance, input };
}

export type PlanningSnapshot = ReturnType<typeof buildPlanningSnapshot>;

/** One read-only snapshot of the database for the planner (SPEC §11.5). */
export async function loadPlanningSnapshot(): Promise<PlanningSnapshot> {
  const source = await loadPlannerSource();
  const back = addDays(source.asOf, -WEEK_CONFIG.lookBackDays);
  const [current, constraints, week, stored, trainedDates] = await Promise.all([
    getCurrentBlock(),
    getActiveConstraints(back),
    getTrainingWeek(),
    getPlannedDays(back, addDays(source.asOf, WEEK_CONFIG.lookAheadDays)),
    getTrainedDates(back),
  ]);
  return buildPlanningSnapshot({ source, current, constraints, week, stored, trainedDates });
}

/** Kept on the phone only, so accepting an obsolete preview cannot silently rebuild it. */
export function planningSnapshotKey(s: PlanningSnapshot): string {
  return JSON.stringify({
    source: s.source,
    current: s.current,
    constraints: s.input.constraints,
    week: s.input.week,
    stored: s.input.stored,
    trainedDates: [...s.input.trainedDates].sort(),
  });
}
