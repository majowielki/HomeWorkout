import { getWeightOn } from '@/db/repositories/bodyMetrics';
import { getReminderSettings } from '@/db/repositories/profile';
import { lastCompletedWorkout } from '@/db/repositories/workouts';
import { weightReminderTimes, workoutReminderTimes } from '@/domain/reminders/schedule';
import { toIsoDate } from '@/domain/time/trainingDate';
import { pl } from '@/strings/pl';

import { ensureNotificationPermission, replaceReminders } from './notifications';

const WEIGHT_PREFIX = 'reminder-weight-';
const WORKOUT_PREFIX = 'reminder-workout-';

/**
 * Recomputes both local reminders from current state and lays them out
 * again as a run of one-off notifications (domain/reminders/schedule.ts
 * explains why a run and not a single "next" instant).
 *
 * Called on app start, after a weigh-in, after a completed or deleted
 * session, after an import and after a settings change — every moment the
 * schedule could have moved. Only the settings screen asks for the OS
 * permission; everywhere else a missing grant just means nothing is
 * scheduled yet. See Documents/IMPLEMENTACJA.md §10.2.
 */
export async function syncReminders(
  options: { requestPermission?: boolean } = {},
  now: Date = new Date(),
): Promise<void> {
  if (options.requestPermission) await ensureNotificationPermission();

  const settings = await getReminderSettings();
  const today = toIsoDate(now);

  const weightToday = await getWeightOn(today);
  await replaceReminders(
    WEIGHT_PREFIX,
    weightReminderTimes(settings, weightToday !== null, now).map((r) => ({
      identifier: `${WEIGHT_PREFIX}${r.date}`,
      title: pl.reminders.weightTitle,
      body: pl.reminders.weightBody,
      date: r.at,
    })),
  );

  const last = await lastCompletedWorkout();
  await replaceReminders(
    WORKOUT_PREFIX,
    workoutReminderTimes(settings, last?.trainingDate ?? null, now).map((r) => ({
      identifier: `${WORKOUT_PREFIX}${r.date}`,
      title: pl.reminders.workoutTitle,
      body: pl.reminders.workoutBody(r.daysSinceSession),
      date: r.at,
    })),
  );
}
