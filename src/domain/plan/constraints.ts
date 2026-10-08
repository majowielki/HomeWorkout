/**
 * What the person (or the coach, with the person's consent) asked the
 * planner to respect — Documents/PLAN-TYGODNIA-I-POPRAWKI.md §3.6, §3.9.
 * Plain data with a date range, read by the day planner and the week.
 */

import { PLANNER_CONFIG, type PlannerConfig } from '../config/training';
import { addDays, daysBetween } from '../time/trainingDate';
import type { Exercise, MuscleGroup } from '../types';

export const CONSTRAINT_KINDS = [
  /** Leave these muscles out: strong DOMS (as primary) or a sore muscle (primary or secondary). */
  'avoid_muscle',
  /** No session on these days. */
  'rest_day',
  /** A session on these days although the weekly pattern rests. */
  'train_day',
  /** One set per exercise on these days. */
  'lighter_day',
] as const;

export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];

export const CONSTRAINT_REASONS = ['doms', 'pain', 'busy', 'other'] as const;

export type ConstraintReason = (typeof CONSTRAINT_REASONS)[number];

/**
 * What the coach may propose, with the person's consent: never a forced
 * training day, and never a sore muscle — pain is the person's own report
 * (the form asks the questions a model cannot).
 */
export const COACH_CONSTRAINT_KINDS = [
  'avoid_muscle',
  'rest_day',
  'lighter_day',
] as const satisfies readonly ConstraintKind[];

export const COACH_CONSTRAINT_REASONS = [
  'doms',
  'busy',
  'other',
] as const satisfies readonly ConstraintReason[];

export type CoachConstraintReason = (typeof COACH_CONSTRAINT_REASONS)[number];

export interface PlanConstraint {
  id: string;
  kind: ConstraintKind;
  /** For `avoid_muscle`; empty otherwise. */
  muscles: MuscleGroup[];
  /** First and last day it applies, inclusive. */
  from: string;
  until: string;
  reason: ConstraintReason;
  source: 'user' | 'coach';
  note: string | null;
}

/** The weekly pattern of training days. 0 = Monday … 6 = Sunday. */
export interface TrainingWeek {
  restWeekdays: readonly number[];
}

/** Every day a training day — the user's choice of 2026-10-02. */
export const TRAIN_DAILY: TrainingWeek = { restWeekdays: [] };

/** Monday-based day of the week of a 'YYYY-MM-DD' date, 0-6. */
export function weekdayOf(date: string): number {
  return ((daysBetween('2024-01-01', date) % 7) + 7) % 7; // 2024-01-01 was a Monday
}

export function constraintsOn(
  constraints: readonly PlanConstraint[],
  date: string,
): PlanConstraint[] {
  return constraints.filter((c) => c.from <= date && date <= c.until);
}

/** The muscles left out on a date: as a primary muscle, and as any muscle at all. */
export interface Avoided {
  primary: ReadonlySet<MuscleGroup>;
  any: ReadonlySet<MuscleGroup>;
}

/**
 * Strong DOMS leaves the muscle out as a primary one — a little work from
 * another exercise helps it recover (Documents/…, appendix D). A sore
 * muscle (suspected strain) is left out entirely, secondary work included.
 */
export function avoidedOn(constraints: readonly PlanConstraint[], date: string): Avoided {
  const primary = new Set<MuscleGroup>();
  const any = new Set<MuscleGroup>();
  for (const c of constraintsOn(constraints, date)) {
    if (c.kind !== 'avoid_muscle') continue;
    for (const m of c.muscles) (c.reason === 'pain' ? any : primary).add(m);
  }
  for (const m of any) primary.add(m);
  return { primary, any };
}

/** Whether the exercise trains a muscle that is left out today. */
export function isAvoided(
  exercise: Pick<Exercise, 'primaryMuscles' | 'secondaryMuscles'>,
  avoided: Avoided,
): boolean {
  return (
    exercise.primaryMuscles.some((m) => avoided.primary.has(m)) ||
    exercise.secondaryMuscles.some((m) => avoided.any.has(m))
  );
}

export function isTrainingDay(
  date: string,
  week: TrainingWeek,
  constraints: readonly PlanConstraint[],
): boolean {
  const today = constraintsOn(constraints, date);
  if (today.some((c) => c.kind === 'rest_day')) return false;
  if (today.some((c) => c.kind === 'train_day')) return true;
  return !week.restWeekdays.includes(weekdayOf(date));
}

export function isLighterDay(constraints: readonly PlanConstraint[], date: string): boolean {
  return constraintsOn(constraints, date).some((c) => c.kind === 'lighter_day');
}

/**
 * The day's time budget when the week has rest days: the weekly minutes
 * the daily plan was tuned for (SPEC §10.7) spread over fewer days, inside
 * the day's minimum and maximum. Seven training days keep it unchanged.
 */
export function scaledConfig(
  week: TrainingWeek,
  cfg: PlannerConfig = PLANNER_CONFIG,
): PlannerConfig {
  const days = 7 - new Set(week.restWeekdays.filter((d) => d >= 0 && d < 7)).size;
  if (days >= 7 || days <= 0) return cfg;
  const target = Math.min(
    cfg.sessionMinutes.max,
    Math.max(cfg.sessionMinutes.min, Math.round((cfg.sessionMinutes.target * 7) / days)),
  );
  return { ...cfg, sessionMinutes: { ...cfg.sessionMinutes, target } };
}

/** The dates from `from` for `days` days. */
export function dateRange(from: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(from, i));
}

/** What a calendar choice for one day changes: requests taken back, and requests added. */
export interface DayOverride {
  revoke: string[];
  add: Omit<PlanConstraint, 'id'>[];
}

/**
 * "Dzień wolny" / "Jednak trenuję" for one date (PLAN-TYGODNIA appendix E, E4
 * and E7). The person's earlier choice for that day is replaced. Choosing to
 * train also takes that one day out of an accepted coach request for rest,
 * keeping the rest of its range; muscle restrictions are never touched.
 */
export function overrideDay(
  active: readonly PlanConstraint[],
  date: string,
  train: boolean,
): DayOverride {
  const revoke: string[] = [];
  const add: Omit<PlanConstraint, 'id'>[] = [];
  for (const { id, ...c } of constraintsOn(active, date)) {
    if (train && c.source === 'coach' && c.kind === 'rest_day') {
      revoke.push(id);
      if (c.from < date) add.push({ ...c, until: addDays(date, -1) });
      if (date < c.until) add.push({ ...c, from: addDays(date, 1) });
    } else if (
      c.source === 'user' &&
      (c.kind === 'rest_day' || c.kind === 'train_day') &&
      c.from === date &&
      c.until === date
    ) {
      revoke.push(id);
    }
  }
  add.push({
    kind: train ? 'train_day' : 'rest_day',
    muscles: [],
    from: date,
    until: date,
    reason: train ? 'other' : 'busy',
    source: 'user',
    note: null,
  });
  return { revoke, add };
}
