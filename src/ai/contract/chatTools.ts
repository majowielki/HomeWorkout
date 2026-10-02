/**
 * The read-only tools of the chat (AI-INTEGRACJA F4, decision D1).
 *
 * A tool is declared here and nowhere else: its name, what the model is
 * told about it, the shape of its input and the shape of its output. The
 * Worker declares the tools to the model from these definitions; the phone
 * runs them against its own database; both check what crosses the wire
 * against the same schemas.
 *
 * Outputs are strict, on purpose, for the same reason `coachContextSchema`
 * is (I9): the phone parses what a tool produced through its output schema
 * before sending it, so a new column in the database cannot reach a model
 * by accident. There is no free text in any output. Exercise names come
 * from the shipped catalogue, never from something the person typed.
 *
 * Tools only read. A change to the plan goes the F3 route (validation plus
 * the person's acceptance), never through a tool (I7).
 *
 * `getPlanExplanation` reads the rules engine's plan (M7) as reason codes:
 * the model explains a decision the engine made, never one of its own,
 * and the tool carries no load, so there is nothing to prescribe from.
 */
import { z } from 'zod';

import { MUSCLE_GROUPS, TREND_VERDICTS } from '../../domain/coach/vocabulary';
import {
  BIKE_REASONS,
  DAY_REASONS,
  FATIGUE_SIGNALS,
  PROGRESSION_REASONS,
  SKIP_REASONS,
} from '../../domain/plan/reasons';
import { isoDate, setSchema, volumeWeekSchema, waistSchema, weightSchema } from './coachContext';

export const TOOL_NAMES = [
  'getRecentSessions',
  'getExerciseHistory',
  'getWeeklyVolume',
  'getBodyTrend',
  'findExercises',
  'getPlanExplanation',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Bounds on what a tool may be asked for and may return. Also the model's allowed range. */
export const TOOL_LIMITS = {
  recentSessions: { min: 1, max: 6 },
  historyWeeks: { min: 1, max: 12 },
  /** Sessions of one exercise shown; the count of all of them in range is always given. */
  historySessionsShown: 8,
  /** 0 is the week ending today. */
  weeksAgo: { min: 0, max: 11 },
  bodyDays: { min: 7, max: 90 },
  findResults: 10,
  queryChars: 40,
  /** 0 is today; a past day has a plan only if a session was started from one. */
  planDaysAgo: { min: 0, max: 13 },
  planExercisesShown: 12,
  planSkippedShown: 20,
} as const;

const count = z.number().int().nonnegative();

const exerciseRef = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
});

export const TOOL_ERRORS = ['invalid_input', 'unknown_exercise', 'no_plan', 'failed'] as const;

/**
 * What any tool may return instead of its output. A failure is data the
 * model can read and answer around ("I could not look that up"), not an
 * exception that ends the conversation.
 */
export const toolErrorSchema = z.strictObject({ error: z.enum(TOOL_ERRORS) });
export type ToolError = z.infer<typeof toolErrorSchema>;

export const CHAT_TOOLS = {
  getRecentSessions: {
    description:
      "The person's most recent completed training sessions, newest first: date, duration, how hard it felt (session RPE 1-10), working sets and the exercises done with their set counts. Use it for questions about what was trained lately or how often.",
    input: z.strictObject({
      count: z
        .number()
        .int()
        .min(TOOL_LIMITS.recentSessions.min)
        .max(TOOL_LIMITS.recentSessions.max),
    }),
    output: z.strictObject({
      /** Completed sessions ever, to quote instead of counting the list. */
      totalCompleted: count,
      sessions: z
        .array(
          z.strictObject({
            date: isoDate,
            durationMin: count.nullable(),
            sessionRpe: z.number().int().min(1).max(10).nullable(),
            workingSets: count,
            exercises: z.array(exerciseRef.extend({ sets: count })),
          }),
        )
        .max(TOOL_LIMITS.recentSessions.max),
    }),
  },

  getExerciseHistory: {
    description:
      'How one exercise went over the last N weeks: the trend verdict computed by the app (improved, maintained, declined, not_comparable, insufficient_data), how many sessions it appeared in, and the logged sets of the latest sessions (reps or seconds, reps in reserve, load). Get the exerciseId from findExercises first; never guess it.',
    input: z.strictObject({
      exerciseId: z.string().min(1).max(64),
      weeks: z.number().int().min(TOOL_LIMITS.historyWeeks.min).max(TOOL_LIMITS.historyWeeks.max),
    }),
    output: z.strictObject({
      exercise: exerciseRef,
      weeks: z.number().int().positive(),
      /** Sessions in range that included the exercise: quote it, do not count `sessions`. */
      sessionCount: count,
      verdict: z.enum(TREND_VERDICTS),
      /** The latest sessions, oldest first. */
      sessions: z
        .array(z.strictObject({ date: isoDate, sets: z.array(setSchema) }))
        .max(TOOL_LIMITS.historySessionsShown),
    }),
  },

  getWeeklyVolume: {
    description:
      'Working sets per muscle group for one week of 7 days, against the app target range (below_min, in_range, above_max). weeksAgo 0 is the 7 days ending today, 1 the 7 days before that, and so on. A secondary muscle counts half a set.',
    input: z.strictObject({
      weeksAgo: z.number().int().min(TOOL_LIMITS.weeksAgo.min).max(TOOL_LIMITS.weeksAgo.max),
    }),
    output: volumeWeekSchema,
  },

  getBodyTrend: {
    description:
      'Body weight and waist over the last N days: latest value, 7-day average, change and slope per week as computed by the app. Either may be null when there are not enough measurements.',
    input: z.strictObject({
      days: z.number().int().min(TOOL_LIMITS.bodyDays.min).max(TOOL_LIMITS.bodyDays.max),
    }),
    output: z.strictObject({
      days: z.number().int().positive(),
      weight: weightSchema.nullable(),
      waist: waistSchema.nullable(),
    }),
  },

  findExercises: {
    description:
      'Look up exercises in the catalogue by muscle group and/or part of the name, to get the exerciseId that getExerciseHistory needs. At least one of muscle or query.',
    input: z.strictObject({
      muscle: z.enum(MUSCLE_GROUPS).optional(),
      query: z.string().min(1).max(TOOL_LIMITS.queryChars).optional(),
    }),
    output: z.strictObject({
      /** All matches, of which at most `findResults` are listed. */
      total: count,
      exercises: z
        .array(exerciseRef.extend({ primaryMuscles: z.array(z.enum(MUSCLE_GROUPS)) }))
        .max(TOOL_LIMITS.findResults),
    }),
  },

  getPlanExplanation: {
    description:
      "The app's training plan for one day and why it looks the way it does, as reason codes computed by the app's rules engine: the day as a whole, the bike, each planned exercise, and every movement left out that day with the reason. daysAgo 0 is today (the plan as it stands now, or as frozen when today's session started); a past day has a plan only if a session was started from one. Use it for questions like why an exercise is or is not in the plan. It carries no loads: the plan screen shows them.",
    input: z.strictObject({
      daysAgo: z.number().int().min(TOOL_LIMITS.planDaysAgo.min).max(TOOL_LIMITS.planDaysAgo.max),
    }),
    output: z.strictObject({
      date: isoDate,
      /** `session`: frozen when that day's session started. `today`: computed now, not started yet. */
      source: z.enum(['session', 'today']),
      blockIndex: z.number().int().positive(),
      phase: z.enum(['work', 'deload']),
      dayReasons: z.array(z.enum(DAY_REASONS)),
      signals: z.array(z.enum(FATIGUE_SIGNALS)),
      bike: z.strictObject({
        minutes: count,
        reasons: z.array(z.enum(BIKE_REASONS)),
      }),
      exercises: z
        .array(
          z.strictObject({
            exercise: exerciseRef,
            /** The movement slot, in Polish, from the shipped data. */
            movement: z.string().min(1).max(60),
            sets: count,
            reasons: z.array(z.enum(PROGRESSION_REASONS)),
          }),
        )
        .max(TOOL_LIMITS.planExercisesShown),
      skipped: z
        .array(
          z.strictObject({
            movement: z.string().min(1).max(60),
            exercise: exerciseRef.nullable(),
            reason: z.enum(SKIP_REASONS),
          }),
        )
        .max(TOOL_LIMITS.planSkippedShown),
    }),
  },
} as const satisfies Record<ToolName, { description: string; input: z.ZodType; output: z.ZodType }>;

export type ToolInput<N extends ToolName> = z.infer<(typeof CHAT_TOOLS)[N]['input']>;
export type ToolOutput<N extends ToolName> = z.infer<(typeof CHAT_TOOLS)[N]['output']>;

/** What a result of this tool may look like: its output, or a tool error. */
export function toolResultSchemaFor(name: ToolName) {
  return z.union([CHAT_TOOLS[name].output, toolErrorSchema]);
}
