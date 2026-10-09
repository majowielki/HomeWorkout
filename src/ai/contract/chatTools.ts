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
import { SHORTFALL_REASONS } from '../../domain/types';

import { MUSCLE_GROUPS, TREND_VERDICTS } from '../../domain/coach/vocabulary';
import { PLANNER_CONFIG, WEEK_CONFIG } from '../../domain/config/training';
import { COACH_CONSTRAINT_KINDS, COACH_CONSTRAINT_REASONS } from '../../domain/plan/constraints';
import { SLOT_REGIONS } from '../../domain/plan/types';
import {
  BIKE_REASONS,
  DAY_REASONS,
  FATIGUE_SIGNALS,
  PROGRESSION_REASONS,
  REQUEST_DAY_REASONS,
  REQUEST_SKIP_REASONS,
  SKIP_REASONS,
} from '../../domain/plan/reasons';
import { DECISION_CODES } from '../../domain/progression/codes';
import { isoDate, setSchema, volumeWeekSchema, waistSchema, weightSchema } from './coachContext';
import {
  activeSessionSummarySchema,
  assessmentSummarySchema,
  sessionChangeInputSchema,
  sessionProposalSummarySchema,
} from './sessionTools';
import { simulateInputSchema, simulateOutputSchema } from './simulationTools';

export const TOOL_NAMES = [
  'getRecentSessions',
  'getExerciseHistory',
  'getWeeklyVolume',
  'getBodyTrend',
  'findExercises',
  'getPlanExplanation',
  'getWeekPlan',
  'proposePlanChange',
  'proposeExtraSession',
  'getDayOptions',
  'proposeDayPlan',
  'getActiveSession',
  'assessSessionChange',
  'proposeSessionChange',
  'simulateProposal',
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
  /** Days of the rolling plan the week tool and a proposal may describe. */
  planDays: WEEK_CONFIG.horizonDays,
  /** Requests in one proposal. */
  proposalConstraints: 3,
  /** Days one composition may cover. */
  composedDays: 3,
  /** Movements one composed day may name: as many exercises as a session holds. */
  composedMovements: PLANNER_CONFIG.maxExercisesPerSession,
  /** Sets a composed movement may ask for: the engine's daily maximum for one muscle. */
  composedSets: PLANNER_CONFIG.maxDirectSetsPerMuscleDay,
  /** Movements listed by the day options tool. */
  dayOptionsShown: 24,
} as const;

const count = z.number().int().nonnegative();

const exerciseRef = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
});

export const TOOL_ERRORS = [
  'invalid_input',
  'unknown_exercise',
  'no_plan',
  'failed',
  'in_progress',
  'finish_first',
  'rest_day',
  'clarification_required',
  'date_changed',
  /** Today is already trained: its plan is closed. */
  'day_done',
  /** No workout is under way: the session tools have nothing to look at. */
  'no_active_session',
  /** The session moved on since the assessment: assess again. */
  'stale_assessment',
] as const;

type PlanReasonCode = (typeof PROGRESSION_REASONS)[number] | (typeof DECISION_CODES)[number];
/** Why a prescription is what it is: the codes of historical sessions and of the second (contract 7). */
export const PLAN_REASON_CODES = [
  ...new Set<string>([...PROGRESSION_REASONS, ...DECISION_CODES]),
] as unknown as readonly [PlanReasonCode, ...PlanReasonCode[]];

export const PLAN_DAY_REASONS = [...DAY_REASONS, ...REQUEST_DAY_REASONS] as const;
export const PLAN_SKIP_REASONS = [...SKIP_REASONS, ...REQUEST_SKIP_REASONS] as const;
/** Why the engine did not take a composed movement: a skip reason, or the day rests. */
export const COMPOSE_CONFLICTS = [...PLAN_SKIP_REASONS, 'REST_DAY'] as const;

/** Relative dates keep the model from inventing a calendar date. The phone resolves them. */
export const planIntentSchema = z.strictObject({
  kind: z.enum(COACH_CONSTRAINT_KINDS),
  muscles: z.array(z.enum(MUSCLE_GROUPS)).max(MUSCLE_GROUPS.length),
  fromDaysAhead: z
    .number()
    .int()
    .min(0)
    .max(TOOL_LIMITS.planDays - 1),
  days: z.number().int().min(1).max(WEEK_CONFIG.requestMaxDays),
  reason: z.enum(COACH_CONSTRAINT_REASONS),
  domsLevel: z.number().int().min(1).max(5).optional(),
});

export const planDaySummarySchema = z.strictObject({
  date: isoDate,
  status: z.enum(['planned', 'done', 'in_progress']),
  rest: z.boolean(),
  /** The day's movements were composed with the coach and accepted (ADR 0006). */
  composed: z.boolean(),
  regions: z.array(z.enum(SLOT_REGIONS)),
  phase: z.enum(['work', 'deload']).nullable(),
  estimatedMinutes: count,
  dayReasons: z.array(z.enum(PLAN_DAY_REASONS)),
  exercises: z
    .array(
      z.strictObject({
        exercise: exerciseRef,
        sets: count,
        perSide: z.boolean(),
        movement: z.string().min(1).max(60),
      }),
    )
    .max(TOOL_LIMITS.planExercisesShown),
  skipped: z
    .array(
      z.strictObject({ movement: z.string().min(1).max(60), reason: z.enum(PLAN_SKIP_REASONS) }),
    )
    .max(TOOL_LIMITS.planSkippedShown),
});

const proposalConstraintSchema = z.strictObject({
  kind: z.enum(COACH_CONSTRAINT_KINDS),
  muscles: z.array(z.enum(MUSCLE_GROUPS)),
  from: isoDate,
  until: isoDate,
  reason: z.enum(COACH_CONSTRAINT_REASONS),
});

export const planProposalSummarySchema = z.strictObject({
  proposalId: z.string().min(1).max(64),
  kind: z.literal('plan'),
  requiresAcceptance: z.literal(true),
  constraints: z.array(proposalConstraintSchema).min(1).max(TOOL_LIMITS.proposalConstraints),
  changes: z
    .array(z.strictObject({ before: planDaySummarySchema, after: planDaySummarySchema }))
    .max(TOOL_LIMITS.planDays),
});

export const extraProposalSummarySchema = z.strictObject({
  proposalId: z.string().min(1).max(64),
  kind: z.literal('extra'),
  requiresAcceptance: z.literal(true),
  focusMuscles: z.array(z.enum(MUSCLE_GROUPS)).min(1).max(MUSCLE_GROUPS.length),
  day: planDaySummarySchema,
});

const movementName = z.string().min(1).max(60);
const slotId = z.string().min(1).max(64);

export const dayOptionsSchema = z.strictObject({
  date: isoDate,
  rest: z.boolean(),
  phase: z.enum(['work', 'deload']).nullable(),
  options: z
    .array(
      z.strictObject({
        slotId,
        movement: movementName,
        exercise: exerciseRef.nullable(),
        available: z.boolean(),
        reason: z.enum(PLAN_SKIP_REASONS).nullable(),
        sets: count,
      }),
    )
    .max(TOOL_LIMITS.dayOptionsShown),
  plan: planDaySummarySchema,
});

export const composeIntentSchema = z.strictObject({
  days: z
    .array(
      z.strictObject({
        daysAhead: z
          .number()
          .int()
          .min(0)
          .max(TOOL_LIMITS.planDays - 1),
        slots: z
          .array(
            z.strictObject({
              slotId,
              sets: z.number().int().min(1).max(TOOL_LIMITS.composedSets).optional(),
              /** Only after the person was told the muscles have not recovered and said they want it anyway. */
              confirmRecovery: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(TOOL_LIMITS.composedMovements),
      }),
    )
    .min(1)
    .max(TOOL_LIMITS.composedDays),
  note: z.string().min(1).max(160),
});

export const composeProposalSummarySchema = z.strictObject({
  /** Null when the engine could take nothing: there is no card to apply. */
  proposalId: z.string().min(1).max(64).nullable(),
  kind: z.literal('compose'),
  requiresAcceptance: z.literal(true),
  days: z
    .array(
      z.strictObject({
        date: isoDate,
        /** At least one movement was taken; the rest are conflicts. */
        applied: z.boolean(),
        conflicts: z
          .array(z.strictObject({ movement: movementName, reason: z.enum(COMPOSE_CONFLICTS) }))
          .max(TOOL_LIMITS.composedMovements),
      }),
    )
    .max(TOOL_LIMITS.composedDays),
  changes: z
    .array(z.strictObject({ before: planDaySummarySchema, after: planDaySummarySchema }))
    .max(TOOL_LIMITS.planDays),
});

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
      "The person's most recent completed training sessions, newest first: date, duration, how hard it felt (session RPE 1-10), working sets and the exercises done with their set counts and reported shortfall reasons (each with its set count). Use it for questions about what was trained lately or how often. For individual sets and their reasons use getExerciseHistory.",
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
            exercises: z.array(
              exerciseRef.extend({
                sets: count,
                shortfalls: z
                  .array(
                    z.strictObject({
                      reason: z.enum(SHORTFALL_REASONS),
                      sets: z.number().int().positive(),
                    }),
                  )
                  .max(SHORTFALL_REASONS.length),
              }),
            ),
          }),
        )
        .max(TOOL_LIMITS.recentSessions.max),
    }),
  },

  getExerciseHistory: {
    description:
      'How one exercise went over the last N weeks: the trend verdict computed by the app (improved, maintained, declined, not_comparable, insufficient_data), how many sessions it appeared in, and the logged sets of the latest sessions (reps or seconds, reps in reserve, load, and the user-reported shortfall reason or null). Get the exerciseId from findExercises first; never guess it.',
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
      dayReasons: z.array(z.enum(PLAN_DAY_REASONS)),
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
            reasons: z.array(z.enum(PLAN_REASON_CODES)),
          }),
        )
        .max(TOOL_LIMITS.planExercisesShown),
      skipped: z
        .array(
          z.strictObject({
            movement: z.string().min(1).max(60),
            exercise: exerciseRef.nullable(),
            reason: z.enum(PLAN_SKIP_REASONS),
          }),
        )
        .max(TOOL_LIMITS.planSkippedShown),
    }),
  },
  getWeekPlan: {
    description:
      'Read the current rolling seven-day plan, including requested rest and muscle restrictions as reason codes. Loads and repetition targets are omitted. Explain only the engine decisions returned here.',
    input: z.strictObject({}),
    output: z.strictObject({
      asOf: isoDate,
      days: z.array(planDaySummarySchema).max(TOOL_LIMITS.planDays),
    }),
  },
  proposePlanChange: {
    description:
      'Preview a user-requested change through the rules engine, without saving anything. The user must press Apply in a local review card. Offer avoid_muscle only for explicitly strong DOMS (domsLevel 4-5) or a non-medical preference; ask about severity first if unknown. Mild DOMS does not exclude a muscle. No pain, injury, joint symptoms, loads, exercise IDs, or treatment requests. fromDaysAhead 0 means the training date shown in facts. days is 1-3 and the range must end inside the horizon. rest_day and lighter_day have empty muscles. Do not claim the plan has changed.',
    input: z.strictObject({
      constraints: z.array(planIntentSchema).min(1).max(TOOL_LIMITS.proposalConstraints),
      note: z.string().min(1).max(160),
    }),
    output: planProposalSummarySchema,
  },
  proposeExtraSession: {
    description:
      "Preview a user-requested additional session for the given muscle groups after today's main workout was completed. The engine chooses available slots and validates the recipe. Nothing is started until the user presses Apply in the local card. Do not prescribe loads or choose exercises directly.",
    input: z.strictObject({
      focusMuscles: z.array(z.enum(MUSCLE_GROUPS)).min(1).max(MUSCLE_GROUPS.length),
    }),
    output: extraProposalSummarySchema,
  },
  getDayOptions: {
    description:
      "The movements the app's rules engine offers for one day of the plan (daysAhead 0 is today), for composing that day with the person: each movement's slotId, the block's exercise for it, whether it can be trained that day and, if not, the engine's reason (RECOVERING, DOMS_HIGH, VOLUME_AT_MAX, AVOIDED_BY_REQUEST, NO_CANDIDATE …), and the sets the engine would give. Also the engine's own plan for the day. Read it before proposeDayPlan, and use the reasons to explain what is possible. No loads.",
    input: z.strictObject({
      daysAhead: z
        .number()
        .int()
        .min(0)
        .max(TOOL_LIMITS.planDays - 1),
    }),
    output: dayOptionsSchema,
  },
  proposeDayPlan: {
    description:
      "Preview a day (or up to three days) composed with the person from the engine's options, without saving anything. Name movements by the slotId from getDayOptions; you may ask for fewer sets than the engine offers, never more, and never name loads, repetitions or exercises. The engine builds the day and returns per day whether it could take the movements and, for those it could not, the reason. A movement whose muscles have not recovered (RECOVERING) is left out unless the person was told and confirmed it: then set confirmRecovery on that movement. The person must press Apply in the local card. Ask first when the day, the muscles or the length is unclear. Do not claim the plan has changed.",
    input: composeIntentSchema,
    output: composeProposalSummarySchema,
  },
  getActiveSession: {
    description:
      "The workout that is under way, as the app's rules engine has it: the exercises in order with how many sets are done, pending and skipped, the muscles each trains, the sets each muscle has had today against the daily maximum, and the seconds left of the session. Use it to find the exposureId of the exercise the person is on before asking about a change to it. Returns no_active_session when no workout is running.",
    input: z.strictObject({}),
    output: activeSessionSummarySchema,
  },
  assessSessionChange: {
    description:
      "Ask the rules engine whether a change to the workout under way is advisable, without changing anything: add an exercise (name it in the person's words), add sets to an exercise, swap what is left of it for another exercise, drop sets or make the rest easier, skip the rest, or report that it felt too hard or too easy. The answer is the engine's: a verdict (ok, ok_with_changes, not_recommended, blocked, needs_clarification), the checks behind it with their figures, the sets it recommends, what it would prescribe, and up to three alternatives, each assessed the same way. A blocked change is not possible and an unknown exercise is not assessed: say so and offer the alternatives. Quote the figures as they are. Get exposureId from getActiveSession. Maximum two calls in one turn.",
    input: sessionChangeInputSchema,
    output: assessmentSummarySchema,
  },
  proposeSessionChange: {
    description:
      'Put an assessed change on a card on the phone for the person to accept or refuse; nothing changes until they press the button. Give the assessmentId and patchId of the assessment or of one of its alternatives. A change the engine advised against can still be accepted knowingly: the card lists what the person has to accept. Never claim the change was made, and never propose one the person did not ask for or accept in words. Returns stale_assessment when the workout moved on: assess again.',
    input: z.strictObject({
      assessmentId: z.string().regex(/^[0-9a-f]{64}$/),
      patchId: z.string().regex(/^[0-9a-f]{64}$/),
    }),
    output: sessionProposalSummarySchema,
  },
  simulateProposal: {
    description:
      "Check what a proposal would do to the coming days, with the same planner that makes the plan, before suggesting it: a week change (rest day, lighter day, a muscle left out), a change of the person's sets per exercise or volume profile, or a change to the workout under way. It returns the plan as it stands and the plan with the proposal side by side (sets per muscle against its minimum and maximum, minutes per day, expected steps up in resistance, expected trial sets, whether a deload comes) and their difference, and the engine's warnings. It is a forecast that assumes the person does what is planned (follows_plan) or what the last four weeks suggest (observed_trend). Nothing is saved. Before a week or policy proposal, call it and quote one or two figures from the difference; never present the forecast as a promise.",
    input: simulateInputSchema,
    output: simulateOutputSchema,
  },
} as const satisfies Record<ToolName, { description: string; input: z.ZodType; output: z.ZodType }>;

/**
 * What a tool does to the world (11 §13): the ones that only look, and the ones that put a proposal in
 * front of the person. No tool of the chat changes anything on its own; a proposal needs the person's
 * acceptance on the phone, and asking again after a timeout gives the same card.
 */
export const TOOL_ANNOTATIONS: Record<
  ToolName,
  { readOnly: boolean; proposal: boolean; idempotent: boolean }
> = {
  getRecentSessions: { readOnly: true, proposal: false, idempotent: true },
  getExerciseHistory: { readOnly: true, proposal: false, idempotent: true },
  getWeeklyVolume: { readOnly: true, proposal: false, idempotent: true },
  getBodyTrend: { readOnly: true, proposal: false, idempotent: true },
  findExercises: { readOnly: true, proposal: false, idempotent: true },
  getPlanExplanation: { readOnly: true, proposal: false, idempotent: true },
  getWeekPlan: { readOnly: true, proposal: false, idempotent: true },
  getDayOptions: { readOnly: true, proposal: false, idempotent: true },
  getActiveSession: { readOnly: true, proposal: false, idempotent: true },
  assessSessionChange: { readOnly: true, proposal: false, idempotent: true },
  simulateProposal: { readOnly: true, proposal: false, idempotent: true },
  proposePlanChange: { readOnly: false, proposal: true, idempotent: true },
  proposeExtraSession: { readOnly: false, proposal: true, idempotent: true },
  proposeDayPlan: { readOnly: false, proposal: true, idempotent: true },
  proposeSessionChange: { readOnly: false, proposal: true, idempotent: true },
};

export type ToolInput<N extends ToolName> = z.infer<(typeof CHAT_TOOLS)[N]['input']>;
export type ToolOutput<N extends ToolName> = z.infer<(typeof CHAT_TOOLS)[N]['output']>;

/** What a result of this tool may look like: its output, or a tool error. */
export function toolResultSchemaFor(name: ToolName) {
  return z.union([CHAT_TOOLS[name].output, toolErrorSchema]);
}
