/**
 * Bringing the stored week up to date, SPEC §11.5 — the pure part, so the
 * rules are tested here and the repository only reads and writes rows.
 *
 * On every look at the plan: past days are marked done or missed, the
 * horizon is kept at seven days from today, and the week is planned with
 * every stored day kept while it still holds. A missed day, or an explicit
 * request (recalculate, a new request, the coach), plans from scratch.
 */

import {
  PLANNER_CONFIG,
  type PlannerConfig,
  TRAINING_CONFIG,
  WEEK_CONFIG,
} from '../config/training';
import { addDays, daysBetween } from '../time/trainingDate';
import type { DaySelection, SessionPlan, SlotRegion, ViolationCode } from './types';
import { planWeek, type WeekInput, type WeekPlan } from './week';

export const SYNC_TRIGGERS = [
  /** Only new days at the end of the horizon. */
  'horizon',
  /** A planned day went by without a session. */
  'missed_day',
  /** A stored day broke a rule (soreness, an extra session, a changed block …). */
  'unsafe',
  /** "Przelicz tydzień". */
  'manual',
  /** A request was added or taken back. */
  'constraint',
  /** The coach's proposal, accepted. */
  'coach',
] as const;

export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];

export interface StoredDay {
  date: string;
  /** Null on a rest day. */
  selection: DaySelection | null;
  forecast: SessionPlan | null;
  status: 'planned' | 'done' | 'missed';
}

/** One day of the week that is not what it was — for the banner and the calendar. */
export interface StoredDayChange {
  date: string;
  /** The day's regions before and after; null for a rest day. */
  before: SlotRegion[] | null;
  after: SlotRegion[] | null;
  /** The rules the stored day broke; empty when the week was planned from scratch. */
  reasons: ViolationCode[];
}

export interface SyncInput extends Omit<WeekInput, 'from' | 'days' | 'kept'> {
  asOf: string;
  stored: readonly StoredDay[];
  /** Training dates with a completed session. */
  trainedDates: ReadonlySet<string>;
  /** An explicit request: plan from scratch from `from` (today or later). */
  request?: { trigger: 'manual' | 'constraint' | 'coach'; from?: string };
  /** How many days from today the plan reaches, today included. */
  horizonDays?: number;
}

export interface SyncResult {
  /** The first day planned: today, or tomorrow once today is trained. */
  from: string;
  week: WeekPlan;
  /** Past days to mark. */
  statusUpdates: { date: string; status: 'done' | 'missed' }[];
  /** What to store from `from` on. */
  rows: StoredDay[];
  changes: StoredDayChange[];
  /** Why it was planned again; null when nothing but the forecast changed. */
  trigger: SyncTrigger | null;
}

export function syncWeek(
  input: SyncInput,
  cfg: PlannerConfig = PLANNER_CONFIG,
  training = TRAINING_CONFIG,
): SyncResult {
  const { asOf, stored, trainedDates } = input;
  const horizon = input.horizonDays ?? WEEK_CONFIG.horizonDays;
  const byDate = new Map(stored.map((d) => [d.date, d]));

  const statusUpdates: SyncResult['statusUpdates'] = [];
  const missed: string[] = [];
  for (const day of stored) {
    const trained = trainedDates.has(day.date);
    if (day.status !== 'planned') continue;
    if (day.date < asOf) {
      const status = trained || day.selection === null ? 'done' : 'missed';
      statusUpdates.push({ date: day.date, status });
      if (status === 'missed') missed.push(day.date);
    } else if (day.date === asOf && trained) {
      statusUpdates.push({ date: day.date, status: 'done' });
    }
  }

  const from = trainedDates.has(asOf) ? addDays(asOf, 1) : asOf;
  const requested = input.request ? [input.request.from ?? from, from].sort()[1]! : null;
  const freshFrom = requested ?? (missed.length > 0 ? from : null);
  const kept = Object.fromEntries(
    stored.flatMap((d) =>
      d.selection !== null && d.date >= from && (freshFrom === null || d.date < freshFrom)
        ? [[d.date, d.selection]]
        : [],
    ),
  );

  const last = addDays(asOf, horizon - 1);
  const week = planWeek(
    { ...input, from, days: Math.max(0, daysBetween(from, last) + 1), kept },
    cfg,
    training,
  );

  const changes: StoredDayChange[] = [];
  let added = false;
  for (const day of week.days) {
    const before = byDate.get(day.date);
    if (!before) {
      added = true;
      continue;
    }
    if (sameDay(before.selection, day.selection)) continue;
    changes.push({
      date: day.date,
      before: before.forecast?.regions ?? null,
      after: day.forecast?.regions ?? null,
      reasons: [...new Set(day.violations.map((v) => v.code))],
    });
  }

  const trigger: SyncTrigger | null =
    input.request?.trigger ??
    (missed.length > 0 ? 'missed_day' : changes.length > 0 ? 'unsafe' : added ? 'horizon' : null);

  return {
    from,
    week,
    statusUpdates,
    rows: week.days.map((d) => ({
      date: d.date,
      selection: d.selection,
      forecast: d.forecast,
      status: 'planned',
    })),
    changes,
    trigger,
  };
}

/** The same training (or the same rest): items equal in slot, exercise, sets and role. */
function sameDay(a: DaySelection | null, b: DaySelection | null): boolean {
  if (a === null || b === null) return a === b;
  const key = (s: DaySelection) =>
    JSON.stringify(s.items.map((i) => [i.slotId, i.exerciseId, i.sets, i.role]));
  return key(a) === key(b);
}
