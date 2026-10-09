import type { WorkoutRow } from '@/db/repositories/workouts';
import { dayTitle, planTitle } from '@/features/plan/format';
import { pl } from '@/strings/pl';

/** The name of a session in the lists: its day's regions, whichever engine planned it. */
export function workoutTitle(workout: Pick<WorkoutRow, 'sessionPlan' | 'plan'>): string {
  if (workout.sessionPlan) return planTitle(workout.sessionPlan);
  if (workout.plan?.title) return workout.plan.title;
  if (workout.plan) return dayTitle(workout.plan.regions, workout.plan.kind);
  return pl.history.fallbackTitle;
}
