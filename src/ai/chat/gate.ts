import { detectTextSignal } from '@/domain/coach/medicalSignal';
import { detectOutOfScope, type OutOfScopeTopic } from '@/domain/coach/topicGuard';

import { CHAT_LIMITS } from '../contract/chat';
import { cleanText } from '../context/redact';

/**
 * What happens to a message before anything is sent (AI-INTEGRACJA I3, I4).
 *
 * Only `pass` goes on. Every other answer is final: the app replies with a
 * fixed sentence of its own and no request is made, so the text of a
 * complaint, or a question about diet or medication, never reaches the
 * Worker, let alone a provider.
 *
 * Medical is judged first: a message that is both is the more sensitive
 * of the two. Muscle soreness is not a complaint and passes: it is exactly
 * what the coach is for.
 */
export type Gate =
  | { kind: 'pass'; text: string }
  | { kind: 'empty' }
  | { kind: 'too_long' }
  | { kind: 'medical' }
  | { kind: 'out_of_scope'; topic: OutOfScopeTopic };

export function gateUserText(raw: string): Gate {
  // Control and invisible characters out first: the length and the detectors see what a model would.
  const text = cleanText(raw);
  if (text === '') return { kind: 'empty' };
  if (text.length > CHAT_LIMITS.userChars) return { kind: 'too_long' };
  if (detectTextSignal(text) === 'medical') return { kind: 'medical' };
  const topic = detectOutOfScope(text);
  if (topic !== null) return { kind: 'out_of_scope', topic };
  return { kind: 'pass', text };
}
