/**
 * Shape of a chat evaluation case (AI-INTEGRACJA §5.1, F4).
 *
 * Like a summary case it is data: a synthetic history that becomes the
 * phone's database, plus a question and what must be true of the answer.
 * The history is what the tools read; the question is what the person
 * types; everything else is expectation.
 *
 * One question per case. A conversation that goes wrong across turns is
 * worth a case of its own once one has been noticed in use.
 */
import { z } from 'zod';

import { TOOL_NAMES } from '@/ai/contract/chatTools';

import { scenarioSchema } from '../schema';

export const CHAT_CATEGORIES = [
  'typical',
  'multi_tool',
  'sparse_data',
  'recovery',
  'medical_gate',
  'out_of_scope',
  'injection',
  'arithmetic',
  'plan_boundary',
  'unknown_data',
] as const;

/** The scorers that apply to a chat turn. */
export const CHAT_SCORERS = [
  'blockedLocally',
  'noLoads',
  'numbersFaithful',
  'sparseVocabulary',
  'medicalPhrase',
  'outOfScope',
  'textRules',
  'grounded',
  'toolLimits',
  'polishOutput',
  'delivered',
] as const;

export type ChatScorerName = (typeof CHAT_SCORERS)[number];

export const chatCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  feature: z.literal('chat'),
  category: z.enum(CHAT_CATEGORIES),
  description: z.string().min(10),
  scenario: scenarioSchema,
  /**
   * The only free text a tool can return is an exercise name. Setting one
   * here puts an instruction in a name, to see whether the model obeys
   * data. Hypothetical for the shipped catalogue, which is why it is a test.
   */
  poisonedExercise: z.strictObject({ id: z.string(), name: z.string().min(1).max(120) }).optional(),
  question: z.string().min(1),
  expect: z.strictObject({
    /** The phone must stop this message itself: nothing may be sent. */
    gate: z.enum(['medical', 'out_of_scope']).optional(),
    /** Tools the answer has to be grounded in: each must have been called. */
    tools: z.array(z.enum(TOOL_NAMES)).optional(),
    scorers: z.array(z.enum(CHAT_SCORERS)).min(1),
    /** Whole-word-stem matches that must not appear in the answer. */
    forbidWords: z.array(z.string().min(1)).optional(),
    /** Regular expressions (no flags) that must not match the answer. */
    forbidPatterns: z.array(z.string().min(1)).optional(),
    /** Each group is alternatives (folded substrings); the answer must match one of every group. */
    mentionAnyOf: z.array(z.array(z.string().min(1)).min(1)).optional(),
  }),
});

export type ChatCase = z.infer<typeof chatCaseSchema>;
