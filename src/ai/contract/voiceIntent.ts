/**
 * The voice fallback (Documents/GLOS.md §3): a spoken phrase the phone's
 * vocabulary did not understand, and the actions the screen offers at that
 * moment. The model chooses one of those actions, or `unknown`.
 *
 * It chooses and nothing more. The answer has no number in it: how many
 * seconds "+N s" adds is read from the phrase on the phone, by the same code
 * that reads it when the vocabulary understands the phrase itself. A field
 * for an amount would be a field a model could fill with something else.
 */
import { z } from 'zod';

import type { VoiceActionId } from '../../domain/voice/commands';
import { apiErrorSchema, usageSchema } from './api';
import { CONTRACT_VERSION } from './versions';

export const VOICE_LIMITS = {
  /** A command is a few words; a recogniser's guess at a long sentence is not one. */
  transcriptChars: 120,
  /** The recogniser's other guesses, best first, after the main one. */
  alternatives: 3,
} as const;

export const UNKNOWN = 'unknown' as const;

/**
 * The actions contract 5 lets the phone offer the model. The warm-up's
 * commands came later and are understood on the phone only: offering them
 * would need the next contract, and a Worker deployed together with it.
 */
export const VOICE_INTENT_ACTIONS = [
  'stopwatch_start',
  'stopwatch_stop',
  'set_done',
  'rest_end',
  'rest_extend',
  'skip_exercise',
] as const satisfies readonly VoiceActionId[];

export type VoiceIntentActionId = (typeof VOICE_INTENT_ACTIONS)[number];

export const isIntentAction = (id: VoiceActionId): id is VoiceIntentActionId =>
  (VOICE_INTENT_ACTIONS as readonly string[]).includes(id);

export type VoiceIntent = VoiceIntentActionId | typeof UNKNOWN;

const transcript = z.string().trim().min(1).max(VOICE_LIMITS.transcriptChars);

export const voiceIntentRequestSchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  requestId: z.string().min(8).max(64),
  transcript,
  alternatives: z.array(transcript).max(VOICE_LIMITS.alternatives),
  /** What the screen offers right now; the answer is one of these or `unknown`. */
  available: z
    .array(z.enum(VOICE_INTENT_ACTIONS))
    .min(1)
    .max(VOICE_INTENT_ACTIONS.length)
    .refine((list) => new Set(list).size === list.length, 'available must not repeat'),
});

export type VoiceIntentRequest = z.infer<typeof voiceIntentRequestSchema>;

/**
 * What the model is asked to return, built per request: the enum holds only
 * the actions offered, so the provider's structured output cannot even
 * spell one that is not.
 */
export function voiceIntentOutputSchema(available: readonly VoiceIntentActionId[]) {
  const options: [VoiceIntent, ...VoiceIntent[]] = [UNKNOWN, ...available];
  return z.object({ action: z.enum(options) });
}

/** The widest form of the output, for tests and the architecture check. */
export const voiceIntentOutputShape = voiceIntentOutputSchema(VOICE_INTENT_ACTIONS);

export const voiceIntentOkSchema = z.strictObject({
  kind: z.literal('ok'),
  requestId: z.string(),
  promptVersion: z.string(),
  model: z.string(),
  usage: usageSchema,
  action: z.enum([...VOICE_INTENT_ACTIONS, UNKNOWN]),
  /**
   * `invalid_output`: the model's answer could not be read, or named an action
   * that was not offered, and `unknown` stands in for it. No second try: the
   * person is waiting mid-set and can simply say it again.
   */
  validationOutcome: z.enum(['ok', 'invalid_output']),
});

export const voiceIntentResponseSchema = z.discriminatedUnion('kind', [
  voiceIntentOkSchema,
  ...apiErrorSchema.options,
]);

export type VoiceIntentOk = z.infer<typeof voiceIntentOkSchema>;
export type VoiceIntentResponse = z.infer<typeof voiceIntentResponseSchema>;
