import { loadPlannerSource } from '@/db/repositories/plannerSource';
import { getDayBoundaryHour, getTrainingWeek } from '@/db/repositories/profile';
import { getCurrentBlock } from '@/db/repositories/trainingBlocks';
import { getActiveConstraints, getTrainedDates } from '@/db/repositories/weekPlan';
import { findInProgressWorkout, startExtraWorkout } from '@/db/repositories/workouts';
import { fatigueSignals } from '@/domain/autoregulation/fatigue';
import { advanceBlock } from '@/domain/plan/block';
import { isTrainingDay } from '@/domain/plan/constraints';
import { type PlannerInput } from '@/domain/plan/dayPlanner';
import { slotByExercise } from '@/domain/plan/eligibility';
import { extraSessionOptions, planCustom, selectCustom } from '@/domain/plan/extra';
import type { SessionPlan } from '@/domain/plan/types';
import { trainingDate } from '@/domain/time/trainingDate';
import { SLOTS } from '@/features/plan/slots';

export async function loadExtraSession() {
  const source = await loadPlannerSource();
  const [current, constraints, week, trained, inProgress] = await Promise.all([
    getCurrentBlock(),
    getActiveConstraints(source.asOf),
    getTrainingWeek(),
    getTrainedDates(source.asOf),
    findInProgressWorkout(),
  ]);
  const eligibility = { profile: source.profile, excludedIds: new Set(source.excludedIds) };
  const { block } = advanceBlock(current?.state ?? null, {
    asOf: source.asOf,
    lastSessionDate: source.lastSessionDate,
    signals: fatigueSignals({
      asOf: source.asOf,
      sessions: source.sessions,
      catalog: source.catalog,
      slotOf: slotByExercise(SLOTS),
      daily: source.daily,
    }),
    slots: SLOTS,
    catalog: source.catalog,
    eligibility,
  });
  const input: PlannerInput = { ...source, slots: SLOTS, eligibility, block, constraints };
  return {
    input,
    options: extraSessionOptions(input),
    done: trained.has(source.asOf),
    rest: !isTrainingDay(source.asOf, week, constraints),
    inProgress,
  };
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
