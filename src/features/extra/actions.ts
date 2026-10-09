import { randomUUID } from 'expo-crypto';
import { acceptDay, previewDay, type DayPreview } from '@/db/repositories/planning';
import { loadWeekContext } from '@/db/repositories/weekPlan';
import { findInProgressWorkout } from '@/db/repositories/workouts';
import { isTrainingDay, TRAIN_DAILY } from '@/domain/plan/constraints';
import { planDay, type DayInput } from '@/domain/plan/day';
import { checkText } from '@/domain/session/assessmentText';

/** What the person confirms to train a muscle that has not recovered (D18). */
export const RECOVERY_ADVICE = ['RECOVERING'] as const;

/**
 * Each option is assessed with the work already done today in the same engine input. A movement the
 * engine advises against because its muscles are still recovering has its plan too, marked `advised`:
 * the person may choose it once they have read the advice.
 */
export function extraOptions(input: DayInput) {
  return input.slots
    .filter((s) => s.kind !== 'filler')
    .map((slot) => {
      const plan = (acknowledged: readonly string[]) =>
        planDay({
          ...input,
          only: [{ slotId: slot.id }],
          acknowledged,
          session: { ...input.session, kind: 'extra' },
        });
      const itemOf = (output: ReturnType<typeof planDay>) => {
        const result = output.result;
        return result.kind === 'ready' || result.kind === 'adjusted'
          ? (result.plan.exposures.find((e) => e.slotId === slot.id) ?? null)
          : null;
      };
      const output = plan(input.acknowledged ?? []);
      const result = output.result;
      let item = itemOf(output);
      const skip = output.skipped.find((s) => s.slotId === slot.id);
      let advised = false;
      if (item === null && skip?.reason === 'RECOVERING') {
        item = itemOf(plan([...(input.acknowledged ?? []), ...RECOVERY_ADVICE]));
        advised = item !== null;
      }
      return {
        slotId: slot.id,
        item,
        advised,
        reason: advised ? null : (skip?.reason ?? null),
        explanation:
          result.kind === 'no_feasible_plan' || result.kind === 'unsupported_input'
            ? result.reasons.map((r) => checkText(r)).join(' ')
            : null,
      };
    });
}
export function previewExtraSession(
  slotIds: readonly string[],
  now = new Date(),
  acknowledged: readonly string[] = [],
): DayPreview {
  return previewDay(
    {
      sessionId: randomUUID(),
      kind: 'extra',
      only: slotIds.map((slotId) => ({ slotId })),
      ...(acknowledged.length ? { acknowledged: [...acknowledged] } : {}),
    },
    now,
  );
}
export async function loadExtraSession(now = new Date()) {
  const context = loadWeekContext(now);
  const preview = previewExtraSession([], now);
  const inProgress = await findInProgressWorkout();
  return {
    input: preview.input,
    options: extraOptions(preview.input),
    inProgress,
    done: context.trainedDates.has(context.asOf),
    rest: !isTrainingDay(context.asOf, context.week ?? TRAIN_DAILY, context.constraints ?? []),
  };
}
export class ExtraSessionChangedError extends Error {}
export async function startExtraSession(preview: DayPreview): Promise<string> {
  const live = await loadExtraSession();
  if (live.inProgress) return live.inProgress.id;
  if (
    !live.done ||
    live.rest ||
    live.input.asOf !== preview.asOf ||
    preview.planHash === null ||
    preview.request.kind !== 'extra' ||
    !preview.request.only?.length
  )
    throw new ExtraSessionChangedError();
  const result = acceptDay({
    commandId: randomUUID(),
    request: preview.request,
    expectedPlanHash: preview.planHash,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  if (result.kind === 'storage_error') throw new Error(result.detail);
  if (result.kind !== 'committed') throw new ExtraSessionChangedError();
  return result.result.sessionId;
}
