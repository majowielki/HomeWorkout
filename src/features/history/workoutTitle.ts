import type { WorkoutRow } from '@/db/repositories/workouts';
import { dayTitle, planTitle } from '@/features/plan/format';
import { pl } from '@/strings/pl';

/** The name of a session in the lists: its day's regions, whichever engine planned it. */
export function workoutTitle(workout: Pick<WorkoutRow, 'planV2' | 'plan'>): string {
  if (workout.planV2) return planTitle(workout.planV2);
  if (workout.plan) return dayTitle(workout.plan.regions, workout.plan.kind);
  return pl.history.noTemplate;
}
