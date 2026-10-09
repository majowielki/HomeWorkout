import { randomUUID } from 'expo-crypto';
import { previewDay, type DayPreview } from '@/db/repositories/planningV2';
import {
  getUnseenChanges,
  loadWeekContext,
  syncWeek,
  type PlanBannerV2,
  type WeekSyncRequest,
} from '@/db/repositories/weekPlanV2';
import { MUSCLE_GROUPS } from '@/domain/coach/vocabulary';
import { PLANNER_CONFIG } from '@/domain/config/training';
import { buildHistoryIndex } from '@/domain/history';
import { weekWork } from '@/domain/plan/dayV2';
import { composedOn } from '@/domain/plan/constraints';
import type { SessionPlanV2 } from '@/domain/plan/planV2';
import { summaryOf, type DaySummaryV2, type StoredDayV2 } from '@/domain/plan/weekV2';
import type { BlockEvent } from '@/domain/plan/reasons';
import type { BikePrescription } from '@/domain/progression/bike';
import { addDays } from '@/domain/time/trainingDate';
import type { MuscleGroup } from '@/domain/types';

export interface MuscleRecovery {
  muscle: MuscleGroup;
  lastWorked: string;
  readyOn: string;
}
export interface PlanToday {
  asOf: string;
  preview: DayPreview;
  plan: SessionPlanV2 | null;
  summary: DaySummaryV2;
  events: BlockEvent[];
  volume: Record<MuscleGroup, { certain: number; uncertain: number }>;
  bike: BikePrescription;
  done: boolean;
  rest: boolean;
  recovery: MuscleRecovery[];
  tomorrow: SessionPlanV2 | null;
  week: StoredDayV2[];
  banner: PlanBannerV2 | null;
}

/** Syncs the choices of the week, then previews today's recipe from real results. */
export function readToday(request?: WeekSyncRequest['request'], now = new Date()): PlanToday {
  const { asOf, result } = syncWeek({ request }, now);
  const context = loadWeekContext(now);
  const preview = previewDay({ sessionId: randomUUID() }, now);
  const planned = preview.output.result;
  const done = context.trainedDates.has(asOf);
  const plan =
    !done && (planned.kind === 'ready' || planned.kind === 'adjusted') ? planned.plan : null;
  const index = buildHistoryIndex(
    context.records.filter((r) => r.trainingDate <= asOf),
    context.catalog,
    { muscleWeights: context.preferences.muscleWeights },
  );
  const recovery = MUSCLE_GROUPS.flatMap((muscle) => {
    const lastWorked = index.lastPrimary[muscle];
    if (lastWorked === undefined) return [];
    const readyOn = addDays(lastWorked, PLANNER_CONFIG.recoveryDays + 1);
    return readyOn > asOf ? [{ muscle, lastWorked, readyOn }] : [];
  }).sort((a, b) => a.readyOn.localeCompare(b.readyOn));
  return {
    asOf,
    preview,
    plan,
    summary: summaryOf(
      preview.output,
      plan,
      composedOn(context.constraints ?? [], asOf) !== null,
      preview.advance.block.index,
    ),
    events: preview.advance.events,
    volume: weekWork(index, asOf),
    bike: preview.output.bike,
    done,
    rest: result.rows.find((d) => d.date === asOf)?.selection === null,
    recovery,
    tomorrow: result.rows.find((d) => d.date === addDays(asOf, 1))?.forecast ?? null,
    week: result.rows,
    banner: getUnseenChanges(),
  };
}
