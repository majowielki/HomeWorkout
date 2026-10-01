/**
 * Shape of an evaluation case (AI-INTEGRACJA §5.1).
 *
 * A case is data: a synthetic scenario that becomes a `CoachContext`, plus
 * what the pipeline must do with it (deterministic expectations, checked
 * without a model) and what a model's answer must satisfy (checked by the
 * scorers once there is an answer). Keeping both in one file means a case
 * cannot describe a situation the pipeline does not actually produce:
 * `weeklySummaryCases.test.ts` builds each context and compares.
 */
import { z } from 'zod';

import { MUSCLE_GROUPS, SIGNAL_CODES } from '@/domain/coach/vocabulary';
import type { ScenarioSpec } from '@/ai/testing/synthetic';

export const CATEGORIES = [
  'typical',
  'sparse_data',
  'layoff',
  'recovery',
  'medical_gate',
  'out_of_scope',
  'injection',
  'arithmetic',
  'guardrail_layer2',
] as const;

/** The scorers of AI-INTEGRACJA §5.2 that apply to a free-text answer. */
export const SCORERS = [
  'schemaValid',
  'noLoads',
  'numbersFaithful',
  'sparseVocabulary',
  'medicalPhrase',
  'outOfScope',
  'polishOutput',
  'flagsFromSignals',
  'textRules',
] as const;

const note = z.strictObject({
  daysAgo: z.number().int().nonnegative(),
  source: z.enum(['session', 'daily']),
  text: z.string().min(1),
});

const scenarioSchema = z.strictObject({
  asOf: z.string().optional(),
  sessions: z.number().int().nonnegative().optional(),
  cadenceDays: z.number().int().positive().optional(),
  lastSessionDaysAgo: z.number().int().nonnegative().optional(),
  olderSessions: z.number().int().nonnegative().optional(),
  progress: z.enum(['improving', 'flat', 'declining']).optional(),
  weight: z
    .strictObject({
      startKg: z.number(),
      perWeekKg: z.number(),
      days: z.number().int().positive().optional(),
      lastEntryDaysAgo: z.number().int().nonnegative().optional(),
    })
    .nullable()
    .optional(),
  waist: z.strictObject({ startCm: z.number(), perWeekCm: z.number() }).nullable().optional(),
  sleep: z
    .strictObject({ hours: z.number(), days: z.number().int().positive() })
    .nullable()
    .optional(),
  highSoreness: z.array(z.enum(MUSCLE_GROUPS)).optional(),
  notes: z.array(note).optional(),
}) satisfies z.ZodType<ScenarioSpec>;

export const evalCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  feature: z.enum(['weekly-summary']),
  category: z.enum(CATEGORIES),
  description: z.string().min(10),
  scenario: scenarioSchema,
  /**
   * Notes placed in the context *after* the gate, as if the detectors had
   * missed them. Tests the second layer (the prompt) on its own.
   */
  injectNotes: z.array(note).optional(),
  expect: z.strictObject({
    /** Deterministic: exactly the signals the pipeline must derive. */
    signals: z.array(z.enum(SIGNAL_CODES)),
    /** Deterministic: notes that survive the gate. */
    notesKept: z.number().int().nonnegative(),
    /** Deterministic: notes the gate must withhold, by kind. */
    omissions: z.strictObject({
      medicalNotes: z.number().int().nonnegative(),
      outOfScopeNotes: z.number().int().nonnegative(),
    }),
    /** Scorers that apply once there is an answer. */
    scorers: z.array(z.enum(SCORERS)).min(1),
    /** Whole-word-stem matches that must not appear in the answer. */
    forbidWords: z.array(z.string().min(1)).optional(),
    /** Regular expressions (no flags) that must not match the answer. */
    forbidPatterns: z.array(z.string().min(1)).optional(),
    /** Sentences that must appear in the answer verbatim. */
    requireSentences: z.array(z.string().min(1)).optional(),
  }),
});

export type EvalCase = z.infer<typeof evalCaseSchema>;
