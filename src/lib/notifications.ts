import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { pl } from '@/strings/pl';

/**
 * Two Android channels, because the user should be able to silence one
 * without the other: the rest alarm has to break through mid-workout,
 * a 07:00 "weigh yourself" can be turned down to a quiet ping.
 */
const REST_CHANNEL_ID = 'rest-timer';
const REMINDER_CHANNEL_ID = 'reminders';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let channelsEnsured = false;
let permissionEnsured = false;

async function ensureChannels(): Promise<void> {
  if (channelsEnsured || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(REST_CHANNEL_ID, {
    name: pl.notifications.restChannel,
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 100, 250],
  });
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: pl.notifications.reminderChannel,
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  channelsEnsured = true;
}

/** Whether notifications may be posted right now, without asking. */
export async function hasNotificationPermission(): Promise<boolean> {
  if (permissionEnsured) return true;
  const { status } = await Notifications.getPermissionsAsync();
  permissionEnsured = status === 'granted';
  return permissionEnsured;
}

/**
 * Requests notification permission once per app run. The rest timer works
 * without it (the on-screen countdown and keep-awake are the primary UX),
 * so a denial is not fatal — it just means no alert if the phone gets
 * locked manually during the rest period.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  await ensureChannels();
  if (await hasNotificationPermission()) return true;
  const { status } = await Notifications.requestPermissionsAsync();
  permissionEnsured = status === 'granted';
  return permissionEnsured;
}

/** Schedules a one-off alert for when the rest period ends. */
export async function scheduleRestEndNotification(
  endsAt: Date,
  body: string,
): Promise<string | null> {
  const granted = await ensureNotificationPermission();
  if (!granted) return null;

  return Notifications.scheduleNotificationAsync({
    content: {
      title: pl.notifications.restTitle,
      body,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: endsAt,
      channelId: REST_CHANNEL_ID,
    },
  });
}

export async function cancelNotification(id: string | null): Promise<void> {
  if (!id) return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {
    // Already fired or already cancelled — nothing to do.
  });
}

export interface ReminderNotification {
  identifier: string;
  title: string;
  body: string;
  date: Date;
}

/**
 * Replaces every scheduled reminder whose identifier starts with `prefix`
 * with the given run of one-offs. Identifiers carry the calendar day, so
 * the OS holds exactly one notification per day and a resync is a
 * cancel-all-then-schedule-all with nothing to persist in between.
 *
 * Never asks for permission: a reminder is not worth an OS dialog in the
 * user's face on first launch. Without permission the run is simply not
 * scheduled — the next sync after a grant (rest timer, settings) lays it out.
 */
export async function replaceReminders(
  prefix: string,
  run: readonly ReminderNotification[],
): Promise<void> {
  await ensureChannels();
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(prefix))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );

  if (run.length === 0 || !(await hasNotificationPermission())) return;
  for (const item of run) {
    await Notifications.scheduleNotificationAsync({
      identifier: item.identifier,
      content: { title: item.title, body: item.body, sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: item.date,
        channelId: REMINDER_CHANNEL_ID,
      },
    });
  }
}
