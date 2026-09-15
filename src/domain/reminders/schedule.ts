/**
 * When the two local reminders should fire. Pure: takes `now` and returns
 * instants — the caller owns expo-notifications.
 *
 * Each reminder is laid out as a run of one-off notifications covering
 * the next `REMINDER_HORIZON_DAYS`, not a single "next" instant. A single
 * one-off only survives until it fires; if the user then does not open
 * the app there is nothing scheduled for the day after — and the person
 * who ignored yesterday's nudge is exactly the one the reminder exists
 * for. A run keeps nagging on its own for two weeks; every app open lays
 * it out afresh from current state. See Documents/IMPLEMENTACJA.md §10.2.
 */

import { addDays, daysBetween, toIsoDate } from '../time/trainingDate';

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

/** How far ahead the one-off notifications are laid out on every sync. */
export const REMINDER_HORIZON_DAYS = 14;

export interface ScheduledReminder {
  /** Calendar day the notification belongs to — also its identity for rescheduling. */
  date: string;
  at: Date;
}

export interface WorkoutReminder extends ScheduledReminder {
  /** Whole days between the last completed session and this nudge — for the copy. */
  daysSinceSession: number;
}

function atTime(dateIso: string, hour: number, minute: number): Date {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, hour, minute, 0, 0);
}

export function isMutedOn(settings: ReminderSettings, date: string): boolean {
  return settings.mutedUntil !== null && date <= settings.mutedUntil;
}

export function isMuted(settings: ReminderSettings, now: Date): boolean {
  return isMutedOn(settings, toIsoDate(now));
}

/** The mute end date for "silence for a week" pressed at `now`. */
export function muteUntilDate(now: Date, days = MUTE_DAYS): string {
  return addDays(toIsoDate(now), days - 1);
}

/**
 * Weigh-in nudges for the coming days. Today's is dropped when there is
 * already an entry — the whole reason these are one-offs rather than a
 * repeating daily trigger. Muted days are skipped, so a week of silence
 * ends by itself without the app having to be opened.
 */
export function weightReminderTimes(
  settings: ReminderSettings,
  hasEntryToday: boolean,
  now: Date,
  horizonDays = REMINDER_HORIZON_DAYS,
): ScheduledReminder[] {
  if (!settings.weight.enabled) return [];
  const { hour, minute } = settings.weight;
  const today = toIsoDate(now);
  const out: ScheduledReminder[] = [];

  for (let offset = 0; offset < horizonDays; offset += 1) {
    if (offset === 0 && hasEntryToday) continue;
    const date = addDays(today, offset);
    if (isMutedOn(settings, date)) continue;
    const at = atTime(date, hour, minute);
    if (at.getTime() <= now.getTime()) continue;
    out.push({ date, at });
  }
  return out;
}

/**
 * "You have not trained in a while" nudges: one per day from `afterDays`
 * after the last completed session, for `horizonDays` days. Never fires
 * without a session history — there is nothing to be behind on.
 */
export function workoutReminderTimes(
  settings: ReminderSettings,
  lastSessionDate: string | null,
  now: Date,
  horizonDays = REMINDER_HORIZON_DAYS,
): WorkoutReminder[] {
  if (!settings.workout.enabled || lastSessionDate === null) return [];
  const { afterDays, hour, minute } = settings.workout;
  const today = toIsoDate(now);
  const first = addDays(lastSessionDate, afterDays);
  const start = daysBetween(today, first) > 0 ? first : today;
  const out: WorkoutReminder[] = [];

  for (let offset = 0; offset < horizonDays; offset += 1) {
    const date = addDays(start, offset);
    if (isMutedOn(settings, date)) continue;
    const at = atTime(date, hour, minute);
    if (at.getTime() <= now.getTime()) continue;
    out.push({ date, at, daysSinceSession: daysBetween(lastSessionDate, date) });
  }
  return out;
}
