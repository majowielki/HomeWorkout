import { getWeightOn } from '@/db/repositories/bodyMetrics';
import { getReminderSettings } from '@/db/repositories/profile';
import { lastCompletedWorkout } from '@/db/repositories/workouts';
import { nextWeightReminderAt, nextWorkoutReminderAt } from '@/domain/reminders/schedule';
import { toIsoDate } from '@/domain/time/trainingDate';
import { pl } from '@/strings/pl';

import { cancelByIdentifier, scheduleAt } from './notifications';

const WEIGHT_ID = 'reminder-weight';
const WORKOUT_ID = 'reminder-workout';

/**
 * Recomputes both local reminders from current state and reschedules them.
 *
 * Called on app start, after a weigh-in, after a completed session and
 * after a settings change — every moment the "next time" could have moved.
 * Each reminder is a one-off, not a repeating trigger, which is what lets
 * the weigh-in nudge skip a day that already has an entry.
 * See Documents/IMPLEMENTACJA.md §10.2.
 */
export async function syncReminders(now: Date = new Date()): Promise<void> {
  const settings = await getReminderSettings();
  const today = toIsoDate(now);

  const weightToday = await getWeightOn(today);
  const weightAt = nextWeightReminderAt(settings, weightToday !== null, now);
  if (weightAt) {
    await scheduleAt(WEIGHT_ID, pl.reminders.weightTitle, pl.reminders.weightBody, weightAt);
  } else {
    await cancelByIdentifier(WEIGHT_ID);
  }

  const last = await lastCompletedWorkout();
  const workoutAt = nextWorkoutReminderAt(settings, last?.trainingDate ?? null, now);
  if (workoutAt && last) {
    const daysAgo = Math.round(
      (workoutAt.getTime() - Date.parse(`${last.trainingDate}T00:00:00`)) / 86_400_000,
    );
    await scheduleAt(
      WORKOUT_ID,
      pl.reminders.workoutTitle,
      pl.reminders.workoutBody(daysAgo),
      workoutAt,
    );
  } else {
    await cancelByIdentifier(WORKOUT_ID);
  }
}
