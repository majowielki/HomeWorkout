/**
 * When the two local reminders should next fire. Pure: takes `now` and
 * returns a Date or null — the caller owns expo-notifications.
 * See Documents/IMPLEMENTACJA.md §10.2.
 */

export interface ReminderSettings {
  weight: { enabled: boolean; hour: number; minute: number };
  workout: { enabled: boolean; afterDays: number; hour: number; minute: number };
  /** 'YYYY-MM-DD' — both reminders stay silent through this calendar day. */
  mutedUntil: string | null;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  weight: { enabled: true, hour: 7, minute: 0 },
  workout: { enabled: true, afterDays: 3, hour: 17, minute: 0 },
  mutedUntil: null,
};

export const MUTE_DAYS = 7;

function localIsoDate(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function atTime(dateIso: string, hour: number, minute: number): Date {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, hour, minute, 0, 0);
}

function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  return localIsoDate(new Date(y, m - 1, d + days));
}

export function isMuted(settings: ReminderSettings, now: Date): boolean {
  return settings.mutedUntil !== null && localIsoDate(now) <= settings.mutedUntil;
}

/** The mute end date for "silence for a week" pressed at `now`. */
export function muteUntilDate(now: Date, days = MUTE_DAYS): string {
  return addDays(localIsoDate(now), days - 1);
}

/**
 * Next weigh-in nudge. Scheduled as a one-off (not a repeating trigger)
 * precisely so it can be skipped on a day that already has an entry.
 */
export function nextWeightReminderAt(
  settings: ReminderSettings,
  hasEntryToday: boolean,
  now: Date,
): Date | null {
  if (!settings.weight.enabled || isMuted(settings, now)) return null;
  const { hour, minute } = settings.weight;
  const today = localIsoDate(now);
  const todayAt = atTime(today, hour, minute);
  if (!hasEntryToday && todayAt.getTime() > now.getTime()) return todayAt;
  return atTime(addDays(today, 1), hour, minute);
}

/**
 * Next "you have not trained in a while" nudge — `afterDays` after the last
 * completed session, or tomorrow if that moment has already passed. Never
 * fires without a session history: there is nothing to be behind on.
 */
export function nextWorkoutReminderAt(
  settings: ReminderSettings,
  lastSessionDate: string | null,
  now: Date,
): Date | null {
  if (!settings.workout.enabled || isMuted(settings, now) || lastSessionDate === null) return null;
  const { afterDays, hour, minute } = settings.workout;
  const candidate = atTime(addDays(lastSessionDate, afterDays), hour, minute);
  if (candidate.getTime() > now.getTime()) return candidate;
  return atTime(addDays(localIsoDate(now), 1), hour, minute);
}
