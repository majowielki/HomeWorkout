import { getDayBoundaryHour } from '@/db/repositories/profile';
import { findInProgressWorkout, startExtraWorkout } from '@/db/repositories/workouts';
import { isTrainingDay, TRAIN_DAILY } from '@/domain/plan/constraints';
import { type PlannerInput } from '@/domain/plan/dayPlanner';
import { extraSessionOptions, planCustom, selectCustom } from '@/domain/plan/extra';
import type { SessionPlan } from '@/domain/plan/types';
import { trainingDate } from '@/domain/time/trainingDate';
import { loadPlanningSnapshot, type PlanningSnapshot } from '@/features/plan/planningSnapshot';

/**
 * What an extra session can be built from today, read from the same snapshot
 * the week and the coach's previews use — one way of assembling the engine's
 * input, so a preview and the check at start can only differ when the data did.
 */
export function extraSessionState(s: PlanningSnapshot) {
  const input: PlannerInput = { ...s.input, block: s.advance.block };
  const { asOf } = input;
  return {
    input,
    options: extraSessionOptions(input),
    done: s.input.trainedDates.has(asOf),
    rest: !isTrainingDay(asOf, s.input.week ?? TRAIN_DAILY, s.input.constraints ?? []),
  };
}

export async function loadExtraSession() {
  const [snapshot, inProgress] = await Promise.all([
    loadPlanningSnapshot(),
    findInProgressWorkout(),
  ]);
  return { ...extraSessionState(snapshot), inProgress };
}

export class ExtraSessionChangedError extends Error {}

/** A preview is never trusted at start: re-read every input and compare the resulting plan. */
export async function startExtraSession(
  slotIds: readonly string[],
  preview: SessionPlan,
  acceptedCoach?: { proposalId: string },
): Promise<string> {
  const live = await loadExtraSession();
  if (live.inProgress) return live.inProgress.id;
  const plan = planCustom(live.input, slotIds);
  if (
    !live.done ||
    live.rest ||
    plan.exercises.length === 0 ||
    JSON.stringify(plan) !== JSON.stringify(preview) ||
    trainingDate(new Date(), await getDayBoundaryHour()) !== plan.date
  ) {
    throw new ExtraSessionChangedError();
  }
  const frozen = acceptedCoach
    ? { ...plan, source: 'ai_accepted' as const, coachProposalId: acceptedCoach.proposalId }
    : plan;
  return startExtraWorkout(frozen, selectCustom(live.input, slotIds));
}
