import type { CoachSource } from '@/ai/context/source';
import type { ToolEnvironment } from '@/ai/tools/implementations';
import { syntheticWeekContext } from '@/ai/testing/plan';
import {
  describeWeek,
  describeDayOptions,
  previewPlanChange,
  proposeDayPreview,
  summarizeDay,
  validateExtraQuestion,
  validatePlanIntent,
  type WeekContext,
} from '@/ai/tools/planPreview';
import { advanceBlock } from '@/domain/plan/block';
import { blockContext } from '@/domain/plan/blockContext';
import { isTrainingDay, TRAIN_DAILY } from '@/domain/plan/constraints';
import { planDay } from '@/domain/plan/day';
import { summaryOf } from '@/domain/plan/week';
import { DEFAULT_MODEL_CONTEXT } from '@/domain/resistance/registry';

/** Same planner and previews as the phone, with no write capability. */
export function syntheticPlanningTools(
  source: CoachSource,
  question: string,
): Pick<ToolEnvironment, 'week' | 'proposeChange' | 'proposeExtra' | 'dayOptions' | 'proposeDay'> {
  let cached: WeekContext | undefined;
  const contextOf = () => (cached ??= syntheticWeekContext(source));
  return {
    async week() {
      return describeWeek(contextOf(), null);
    },
    async proposeChange(intent) {
      return (
        validatePlanIntent(intent, question) ??
        previewPlanChange(contextOf(), intent, 'eval-plan-proposal').summary
      );
    },
    async proposeExtra({ focusMuscles }) {
      const invalid = validateExtraQuestion(question);
      if (invalid) return invalid;
      const context = contextOf();
      if (!context.trainedDates.has(context.asOf)) return { error: 'finish_first' };
      if (!isTrainingDay(context.asOf, context.week ?? TRAIN_DAILY, context.constraints ?? []))
        return { error: 'rest_day' };
      const advance = advanceBlock(
        context.block,
        blockContext({
          ...context,
          models: context.models ?? DEFAULT_MODEL_CONTEXT,
          recentBlocks: [],
          deloadRequested: false,
        }),
      );
      const only = context.slots
        .filter(
          (s) =>
            s.kind !== 'filler' &&
            context.catalog[advance.block.selections[s.id]!]?.primaryMuscles.some((m) =>
              focusMuscles.includes(m),
            ),
        )
        .map((s) => ({ slotId: s.id }));
      const output = planDay({
        ...context,
        block: advance.block,
        only,
        session: {
          sessionId: 'eval-extra',
          planRevision: 1,
          kind: 'extra',
          versions: context.versions,
          snapshotFingerprint: context.snapshotFingerprint,
          inputFingerprint: context.snapshotFingerprint,
        },
      });
      if (!('plan' in output.result) || output.result.plan.exposures.length === 0)
        return { error: 'no_plan' };
      const plan = output.result.plan;
      return {
        kind: 'extra',
        requiresAcceptance: true,
        proposalId: 'eval-extra-proposal',
        focusMuscles,
        day: summarizeDay(context, context.asOf, {
          forecast: plan,
          summary: summaryOf(output, plan, false, advance.block.index),
        }),
      };
    },
    async dayOptions({ daysAhead }) {
      return describeDayOptions(contextOf(), daysAhead);
    },
    async proposeDay(intent) {
      const result = proposeDayPreview(contextOf(), intent, question, 'eval-day-proposal');
      return 'error' in result ? result.error : result.preview.summary;
    },
  };
}
