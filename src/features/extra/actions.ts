import { randomUUID } from 'expo-crypto';
import { acceptDay, previewDay, type DayPreview } from '@/db/repositories/planningV2';
import { loadWeekContext } from '@/db/repositories/weekPlanV2';
import { findInProgressWorkout } from '@/db/repositories/workouts';
import { isTrainingDay, TRAIN_DAILY } from '@/domain/plan/constraints';
import { planDayV2, type DayInputV2 } from '@/domain/plan/dayV2';
import { checkText } from '@/domain/session/assessmentText';

/** Each option is assessed with the work already done today in the same engine input. */
export function extraOptions(input: DayInputV2) {
  return input.slots
    .filter((s) => s.kind !== 'filler')
    .map((slot) => {
      const output = planDayV2({
        ...input,
        only: [{ slotId: slot.id }],
        session: { ...input.session, kind: 'extra' },
      });
      const result = output.result;
      const item =
        result.kind === 'ready' || result.kind === 'adjusted'
          ? (result.plan.exposures.find((e) => e.slotId === slot.id) ?? null)
          : null;
      const skip = output.skipped.find((s) => s.slotId === slot.id);
      return {
        slotId: slot.id,
        item,
        reason: skip?.reason ?? null,
        explanation:
          result.kind === 'no_feasible_plan' || result.kind === 'unsupported_input'
            ? result.reasons.map((r) => checkText(r)).join(' ')
            : null,
      };
    });
}
export function previewExtraSession(slotIds: readonly string[], now = new Date()): DayPreview {
  return previewDay(
    { sessionId: randomUUID(), kind: 'extra', only: slotIds.map((slotId) => ({ slotId })) },
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
