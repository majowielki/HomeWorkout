/**
 * The only thing the app ever tells a model about the user.
 *
 * Every object here is strict: a field that is not listed does not exist.
 * That is the mechanism behind "send the minimum" (AI-INTEGRACJA I9) —
 * `buildCoachContext` parses its output through this schema, so a new
 * column in the database cannot leak into a prompt by accident; someone
 * has to add it here, in review, on purpose.
 *
 * Request-side schema, so `z.literal` is fine below. The rules about
 * literals and bounds (AI-INTEGRACJA §4.4) apply to what a model returns —
 * see weeklySummary.ts.
 */
import { z } from 'zod';
import { SHORTFALL_REASONS } from '../../domain/types';

import {
  CONSTRAINT_CODES,
  MUSCLE_GROUPS,
  SIGNAL_CODES,
  TREND_VERDICTS,
  VOLUME_STATUSES,
} from '../../domain/coach/vocabulary';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const muscle = z.enum(MUSCLE_GROUPS);
const count = z.number().int().nonnegative();

export const loadSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('dumbbell'),
    mode: z.enum(['paired', 'single']),
    kg: z.number().positive(),
  }),
  z.strictObject({
    kind: z.literal('band'),
    bandId: z.string().min(1),
    position: z.number().int().min(0).max(3),
  }),
  z.strictObject({ kind: z.literal('bodyweight') }),
]);

export const setSchema = z.strictObject({
  reps: count.nullable(),
  timeSec: count.nullable(),
  rir: z.number().int().min(0).max(10).nullable(),
  /** The user's reported reason; null means none was recorded, never an inferred cause. */
  shortfall: z.enum(SHORTFALL_REASONS).nullable(),
  load: loadSchema,
});

const sessionSchema = z.strictObject({
  date: isoDate,
  template: z.string(),
  durationMin: count.nullable(),
  sessionRpe: z.number().int().min(1).max(10).nullable(),
  workingSets: count,
  exercises: z.array(
    z.strictObject({
      exerciseId: z.string(),
      name: z.string(),
      sets: z.array(setSchema),
    }),
  ),
});

export const volumeWeekSchema = z.strictObject({
  /** The 7 days ending on this date. */
  endDate: isoDate,
  muscles: z.array(
    z.strictObject({
      muscle,
      sets: z.number().positive(),
      status: z.enum(VOLUME_STATUSES),
    }),
  ),
});

const trendSchema = z.strictObject({
  exerciseId: z.string(),
  name: z.string(),
  verdict: z.enum(TREND_VERDICTS),
  sessions: count,
});

export const weightSchema = z.strictObject({
  latestKg: z.number(),
  latestDate: isoDate,
  /** Mean of the weigh-ins in the 7 days ending on the latest one, if there are enough. */
  avg7Kg: z.number().nullable(),
  trendKgPerWeek: z.number().nullable(),
  /** Change of the 7-day mean across the window. */
  avg7ChangeKg: z.number().nullable(),
  entries: count,
});

export const waistSchema = z.strictObject({
  latestCm: z.number(),
  latestDate: isoDate,
  changeCm: z.number().nullable(),
  entries: count,
});

const recoverySchema = z.strictObject({
  daysLogged: count,
  avgSleepHours: z.number().nullable(),
  avgEnergy: z.number().nullable(),
  avgStress: z.number().nullable(),
  /** Muscles reported at the "high" soreness level, and on how many days. */
  highSoreness: z.array(z.strictObject({ muscle, days: count })),
});

/**
 * Free text the user wrote. The only untrusted field in the context: the
 * prompt wraps it as data, and `redactNotes` has already dropped anything
 * that reads as an injury or touches diet or medication.
 */
const noteSchema = z.strictObject({
  date: isoDate,
  source: z.enum(['session', 'daily']),
  text: z.string().min(1).max(280),
});

export const coachContextSchema = z.strictObject({
  /** The training date this summary is about. */
  asOf: isoDate,
  windowDays: z.number().int().positive(),
  goal: z.enum(['lean_mass_retention_in_deficit']),
  constraints: z.array(z.enum(CONSTRAINT_CODES)),
  /** Completed sessions ever, not only those in the window. */
  historicalSessionCount: count,
  /**
   * Sessions in the window, as a number to quote. Without it a model would
   * have to count the list, and counting is the arithmetic it is told not to do.
   */
  sessionCount: count,
  signals: z.array(z.enum(SIGNAL_CODES)),
  sessions: z.array(sessionSchema),
  /** Newest week first. */
  weeklyVolume: z.array(volumeWeekSchema),
  trends: z.array(trendSchema),
  trendSummary: z.strictObject({ improved: count, maintained: count, declined: count }),
  weight: weightSchema.nullable(),
  waist: waistSchema.nullable(),
  recovery: recoverySchema,
  notes: z.array(noteSchema),
});

export type CoachContext = z.infer<typeof coachContextSchema>;
export type SessionContext = z.infer<typeof sessionSchema>;
export type LoadContext = z.infer<typeof loadSchema>;
