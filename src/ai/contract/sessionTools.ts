/**
 * The shapes of the tools that consult the running session (contract 7, 11 §8).
 *
 * The person asks, in the middle of a workout, whether something may be
 * changed: add an exercise, a set, swap what is left, say it is too hard. The
 * rules engine answers from its own state — the verdict, the numbers behind
 * it, what it recommends, what else could be done — and the model only tells
 * that. So the output is the engine's assessment cut down to facts: codes and
 * numbers, ids of the catalogue, no sentence of the person's own words
 * (I9). The input has no field for a load or a repetition target; the model
 * says *what* to change, the engine says *how much*.
 *
 * Nothing here changes the session. A change goes through `proposeSessionChange`
 * to a card on the phone, and the person accepts it there (D26).
 */
import { z } from 'zod';

import { MUSCLE_GROUPS } from '../../domain/coach/vocabulary';
import { RULE_CODES } from '../../domain/policy/hardAdvice';

const count = z.number().int().nonnegative();
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const exposureId = z.string().min(1).max(120);

export const SESSION_LIMITS = {
  exposuresShown: 12,
  /** Assessments the model may ask for in one turn; the person is training, so it must be quick (11 §8). */
  assessmentsPerTurn: 2,
  checksShown: 5,
  alternativesShown: 3,
  candidatesShown: 5,
  nearestShown: 3,
  workShown: 4,
  musclesShown: 8,
  /** Sets a change may ask for; the engine's own technical maximum for an exposure is 10. */
  setsAsked: { min: 1, max: 6 },
  /** A value in the data of a check: long enough for an id or a list of muscles. */
  dataChars: 80,
  dataKeys: 8,
} as const;

const exerciseRef = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
});

export const VERDICTS = [
  'ok',
  'ok_with_changes',
  'not_recommended',
  'blocked',
  'needs_clarification',
] as const;

export const SETS_REASONS = [
  'POLICY_DEFAULT',
  'USER_FIXED',
  'PHASE_DELOAD',
  'LIGHTER_DAY',
  'DAY_ROOM',
  'WEEK_ROOM',
  'TIME',
  'NO_ROOM',
] as const;

export const ALTERNATIVE_REASONS = [
  'same_slot',
  'same_family',
  'variant_easier',
  'variant_harder',
  'substitute',
  'preference',
  'week_min_helped',
] as const;

export const FEEL_OPTION_REASONS = [
  'easier_resistance',
  'variant_easier',
  'drop_set',
  'skip_remaining',
  'add_set',
  'next_prescription',
] as const;

/** What the model may ask the engine to assess. The exercise is named in the person's words. */
export const sessionChangeInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('add_exercise'),
    query: z.string().min(1).max(60),
    sets: z
      .number()
      .int()
      .min(SESSION_LIMITS.setsAsked.min)
      .max(SESSION_LIMITS.setsAsked.max)
      .optional(),
    placement: z.enum(['next', 'end']).optional(),
  }),
  z.strictObject({
    kind: z.literal('add_sets'),
    exposureId,
    sets: z.number().int().min(SESSION_LIMITS.setsAsked.min).max(SESSION_LIMITS.setsAsked.max),
  }),
  z.strictObject({
    kind: z.literal('swap_remaining'),
    exposureId,
    query: z.string().min(1).max(60),
  }),
  z.strictObject({
    kind: z.literal('reduce_remaining'),
    exposureId,
    dropSets: z.number().int().min(1).max(SESSION_LIMITS.setsAsked.max).optional(),
    easier: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal('skip_remaining'), exposureId }),
  z.strictObject({
    kind: z.literal('feel'),
    exposureId: exposureId.nullable(),
    feel: z.enum(['too_hard', 'too_easy']),
  }),
]);

export type SessionChangeInput = z.infer<typeof sessionChangeInputSchema>;

const dataValue = z.union([
  z.number().finite(),
  z.string().max(SESSION_LIMITS.dataChars),
  z.boolean(),
  z.null(),
]);

export const checkSummarySchema = z.strictObject({
  code: z.enum(RULE_CODES),
  class: z.enum(['hard', 'advice', 'info']),
  status: z.enum(['pass', 'warn', 'fail']),
  data: z
    .record(z.string().max(32), dataValue)
    .refine(
      (d) => Object.keys(d).length <= SESSION_LIMITS.dataKeys,
      'a check carries a few numbers, not a table',
    ),
});

/** What is prescribed, as figures the engine computed; a band has no kilograms. */
export const workSummarySchema = z.strictObject({
  sets: count,
  massKg: z.number().nonnegative().finite().nullable(),
  target: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('reps'),
      min: count,
      max: count,
      perSide: z.boolean(),
    }),
    z.strictObject({ kind: z.literal('duration'), minSec: count, maxSec: count }),
    z.strictObject({ kind: z.literal('distance'), meters: z.number().positive().finite() }),
  ]),
});

export const prescriptionSummarySchema = z.strictObject({
  exercise: exerciseRef,
  sets: count,
  work: z.array(workSummarySchema).max(SESSION_LIMITS.workShown),
});

export const alternativeSummarySchema = z.strictObject({
  exercise: exerciseRef,
  why: z.array(z.enum(ALTERNATIVE_REASONS)).max(ALTERNATIVE_REASONS.length),
  verdict: z.enum(VERDICTS),
  assessmentId: hex64,
  patchId: hex64,
  sets: count,
});

export const resolvedSummarySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('exercise'), exercise: exerciseRef }),
  z.strictObject({
    kind: z.literal('ambiguous'),
    candidates: z.array(exerciseRef).max(SESSION_LIMITS.candidatesShown),
  }),
  z.strictObject({
    kind: z.literal('not_found'),
    nearest: z.array(exerciseRef).max(SESSION_LIMITS.nearestShown),
  }),
  z.strictObject({ kind: z.literal('not_applicable') }),
]);

export const feelOptionSummarySchema = z.strictObject({
  why: z.enum(FEEL_OPTION_REASONS),
  verdict: z.enum(VERDICTS),
  assessmentId: hex64.nullable(),
  patchId: hex64.nullable(),
  recommended: z.boolean(),
});

export const assessmentSummarySchema = z.strictObject({
  assessmentId: hex64,
  /** Null when there is nothing to apply: blocked, in need of a clarification, or an observation only. */
  patchId: hex64.nullable(),
  verdict: z.enum(VERDICTS),
  resolved: resolvedSummarySchema,
  checks: z.array(checkSummarySchema).max(SESSION_LIMITS.checksShown),
  recommendation: z
    .strictObject({
      sets: z.strictObject({
        recommended: count,
        allowed: z.tuple([count, count]).nullable(),
        advisable: z.tuple([count, count]),
        reasons: z.array(z.enum(SETS_REASONS)).max(SETS_REASONS.length),
      }),
      placement: z.enum(['next', 'end']),
    })
    .nullable(),
  prescription: prescriptionSummarySchema.nullable(),
  alternatives: z.array(alternativeSummarySchema).max(SESSION_LIMITS.alternativesShown),
  /** For a feel report: the options the engine assessed. Null for any other change. */
  feelOptions: z.array(feelOptionSummarySchema).max(3).nullable(),
  time: z.strictObject({ remainingAfterSec: count, maxSec: count }),
});

export type AssessmentSummary = z.infer<typeof assessmentSummarySchema>;

export const activeSessionSummarySchema = z.strictObject({
  sessionId: z.string().min(1).max(64),
  planRevision: z.number().int().positive(),
  trainingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  exposures: z
    .array(
      z.strictObject({
        exposureId,
        exercise: exerciseRef,
        sets: z.strictObject({ done: count, pending: count, skipped: count }),
        muscles: z.array(z.enum(MUSCLE_GROUPS)),
      }),
    )
    .max(SESSION_LIMITS.exposuresShown),
  musclesToday: z
    .array(
      z.strictObject({
        muscle: z.enum(MUSCLE_GROUPS),
        done: count,
        remainingPlanned: count,
        dayMax: count,
      }),
    )
    .max(SESSION_LIMITS.musclesShown),
  timeRemainingSec: count,
});

export type ActiveSessionSummary = z.infer<typeof activeSessionSummarySchema>;

export const sessionProposalSummarySchema = z.strictObject({
  proposalId: z.string().min(1).max(64),
  kind: z.literal('session_change'),
  requiresAcceptance: z.literal(true),
  verdict: z.enum(VERDICTS),
  patchId: hex64,
  /** The advice the person has to see and accept to go ahead (D19); empty for a change that is simply fine. */
  acknowledge: z.array(z.enum(RULE_CODES)).max(RULE_CODES.length),
});
