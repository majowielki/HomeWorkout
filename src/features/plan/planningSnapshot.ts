import { loadPlannerSource } from '@/db/repositories/plannerSource';
import { getTrainingWeek } from '@/db/repositories/profile';
import { getCurrentBlock } from '@/db/repositories/trainingBlocks';
import { getActiveConstraints, getPlannedDays, getTrainedDates } from '@/db/repositories/weekPlan';
import { fatigueSignals } from '@/domain/autoregulation/fatigue';
import { advanceBlock } from '@/domain/plan/block';
import { slotByExercise } from '@/domain/plan/eligibility';
import type { SyncInput } from '@/domain/plan/weekSync';
import { addDays } from '@/domain/time/trainingDate';
import { SLOTS } from './slots';

/** One read-only snapshot for normal sync and coach previews. Advancing a block here writes nothing. */
export async function loadPlanningSnapshot() {
  const source = await loadPlannerSource();
  const { asOf, catalog } = source;
  const [current, constraints, week, stored, trainedDates] = await Promise.all([
    getCurrentBlock(),
    getActiveConstraints(addDays(asOf, -14)),
    getTrainingWeek(),
    getPlannedDays(addDays(asOf, -14), addDays(asOf, 13)),
    getTrainedDates(addDays(asOf, -14)),
  ]);
  const eligibility = { profile: source.profile, excludedIds: new Set(source.excludedIds) };
  const advance = advanceBlock(current?.state ?? null, {
    asOf,
    lastSessionDate: source.lastSessionDate,
    signals: fatigueSignals({
      asOf,
      sessions: source.sessions,
      catalog,
      slotOf: slotByExercise(SLOTS),
      daily: source.daily,
    }),
    slots: SLOTS,
    catalog,
    eligibility,
  });
  const input: SyncInput = {
    ...source,
    slots: SLOTS,
    eligibility,
    block: advance.block,
    constraints,
    week,
    stored,
    trainedDates,
  };
  return { source, current, advance, input };
}

export type PlanningSnapshot = Awaited<ReturnType<typeof loadPlanningSnapshot>>;

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
