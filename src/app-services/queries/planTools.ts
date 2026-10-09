import type { ToolEnvironment } from '@/ai/tools/implementations';
import { describePlan } from '@/ai/tools/planPreviewV2';
import { loadWeekContext, startedPlanOn } from '@/db/repositories/weekPlanV2';
import { addDays } from '@/domain/time/trainingDate';

/**
 * The explanation of a day's plan on the week of engine v2, read fresh from the database: the plan
 * frozen when that day's session started, or today's from the week. Nothing is written.
 */
export function createPhonePlanTools(): Pick<ToolEnvironment, 'explainPlan'> {
  return {
    async explainPlan({ daysAgo }) {
      const ctx = loadWeekContext();
      return describePlan(ctx, daysAgo, startedPlanOn(addDays(ctx.asOf, -daysAgo)));
    },
  };
}
