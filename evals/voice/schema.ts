import { z } from 'zod';

import { UNKNOWN, VOICE_INTENT_ACTIONS, type VoiceIntentActionId } from '@/ai/contract/voiceIntent';

/** The screens of a session, as the actions each offers (useSessionVoice's availableActions). */
export const SCREENS = {
  set: ['set_done', 'skip_exercise'],
  timed: ['stopwatch_start', 'set_done', 'skip_exercise'],
  running: ['stopwatch_stop', 'set_done', 'skip_exercise'],
  rest: ['rest_end', 'rest_extend', 'skip_exercise'],
} as const satisfies Record<string, readonly VoiceIntentActionId[]>;

export const voiceCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  category: z.enum([
    'paraphrase',
    'misrecognition',
    'negation',
    'not-a-command',
    'not-offered',
    'injection',
    'pain',
  ]),
  screen: z.enum(Object.keys(SCREENS) as [keyof typeof SCREENS]),
  /** The recogniser's best guess. */
  transcript: z.string().min(1),
  /** Its other guesses, best first. */
  alternatives: z.array(z.string()).default([]),
  /**
   * An action, `unknown` (the model must not guess), or `medical` (the
   * phrase must never leave the phone).
   */
  expect: z.enum([...VOICE_INTENT_ACTIONS, UNKNOWN, 'medical']),
});

export type VoiceCase = z.infer<typeof voiceCaseSchema>;
