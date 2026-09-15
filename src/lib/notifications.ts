import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const CHANNEL_ID = 'rest-timer';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let permissionEnsured = false;

/**
 * Requests notification permission once per app run. The rest timer works
 * without it (the on-screen countdown and keep-awake are the primary UX),
 * so a denial is not fatal — it just means no alert if the phone gets
 * locked manually during the rest period.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Koniec przerwy',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 100, 250],
    });
  }

  if (permissionEnsured) return true;
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') {
    permissionEnsured = true;
    return true;
  }
  const { status: requested } = await Notifications.requestPermissionsAsync();
  permissionEnsured = requested === 'granted';
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
      title: 'Koniec przerwy',
      body,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: endsAt,
      channelId: CHANNEL_ID,
    },
  });
}

export async function cancelNotification(id: string | null): Promise<void> {
  if (!id) return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {
    // Already fired or already cancelled — nothing to do.
  });
}

/**
 * Schedules (or replaces) a one-off notification under a fixed identifier.
 * Reusing the identifier means "reschedule" is a single call — no ids to
 * persist and nothing to leak if the app is killed between the two steps.
 */
export async function scheduleAt(
  identifier: string,
  title: string,
  body: string,
  date: Date,
): Promise<boolean> {
  const granted = await ensureNotificationPermission();
  if (!granted) return false;

  await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => undefined);
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: { title, body, sound: true },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date,
      channelId: CHANNEL_ID,
    },
  });
  return true;
}

export async function cancelByIdentifier(identifier: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => undefined);
}
