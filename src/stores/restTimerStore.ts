import { create } from 'zustand';

import { cancelNotification, scheduleRestEndNotification } from '@/lib/notifications';

interface RestTimerState {
  restEndsAt: number | null;
  notificationId: string | null;
  start: (seconds: number, notificationBody: string) => Promise<void>;
  extend: (seconds: number, notificationBody: string) => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Ephemeral, intentionally not persisted. If the app is killed, this state
 * is gone and the countdown card simply won't be showing on relaunch —
 * but the OS-scheduled notification fires regardless, since it lives
 * outside the JS runtime. Session progress itself is never derived from
 * this store; it always comes from set_logs. See SPEC §7.2.
 */
export const useRestTimerStore = create<RestTimerState>((set, get) => ({
  restEndsAt: null,
  notificationId: null,

  start: async (seconds, notificationBody) => {
    await cancelNotification(get().notificationId);
    const endsAt = new Date(Date.now() + seconds * 1000);
    const notificationId = await scheduleRestEndNotification(endsAt, notificationBody);
    set({ restEndsAt: endsAt.getTime(), notificationId });
  },

  extend: async (seconds, notificationBody) => {
    const current = get().restEndsAt ?? Date.now();
    await cancelNotification(get().notificationId);
    const endsAt = new Date(current + seconds * 1000);
    const notificationId = await scheduleRestEndNotification(endsAt, notificationBody);
    set({ restEndsAt: endsAt.getTime(), notificationId });
  },

  stop: async () => {
    await cancelNotification(get().notificationId);
    set({ restEndsAt: null, notificationId: null });
  },
}));
