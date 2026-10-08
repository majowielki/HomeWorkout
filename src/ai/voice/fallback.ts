import {
  extendSeconds,
  type VoiceActionId,
  type VoiceCommand,
  words,
} from '../../domain/voice/commands';
import { gateUserText } from '../chat/gate';
import type { ClientFailure } from '../client/coachClient';
import type { ExchangeRecord } from '../client/exchange';
import type { VoiceCallOutcome, VoiceIntentCaller } from '../client/voiceIntentClient';
import { VOICE_LIMITS, type VoiceIntentRequest } from '../contract/voiceIntent';

export type FallbackOutcome =
  | { kind: 'command'; command: VoiceCommand }
  | { kind: 'unknown' }
  /** The phrase speaks of pain or feeling unwell: it never left the phone. */
  | { kind: 'medical' }
  | { kind: 'failed'; failure: Exclude<ClientFailure['kind'], 'aborted'> | 'invalid_output' }
  | { kind: 'aborted' };

export interface FallbackDeps {
  call: VoiceIntentCaller;
  /** Keeps the exchange in the on-phone diagnostics log. */
  record?: (record: ExchangeRecord) => void;
}

/**
 * The phone's vocabulary gave up on a phrase; ask the model to choose among
 * the actions on screen.
 *
 * The heard text goes through the chat's gate first (AI-INTEGRACJA I3): a
 * phrase about pain is answered on the phone and never sent, and so is one
 * the gate keeps out for other reasons. Any of the recogniser's guesses
 * tripping the medical check stops the whole phrase, because the guess the
 * app would have sent may be the wrong one.
 *
 * The model returns an action name and nothing else. An action the screen
 * did not offer becomes `unknown` here too, whatever the Worker did, and
 * "+N s" gets its amount from the phrase on the phone, as when the
 * vocabulary understands it.
 */
export async function askVoiceFallback(
  alternatives: readonly string[],
  available: readonly VoiceActionId[],
  deps: FallbackDeps,
  signal?: AbortSignal,
): Promise<FallbackOutcome> {
  const gates = alternatives.map(gateUserText);
  if (gates.some((g) => g.kind === 'medical')) return { kind: 'medical' };
  const passed = gates.flatMap((g) =>
    g.kind === 'pass' && g.text.length <= VOICE_LIMITS.transcriptChars ? [g.text] : [],
  );
  const [transcript, ...others] = passed;
  if (transcript === undefined || gates[0]?.kind !== 'pass') return { kind: 'unknown' };

  const request: Pick<VoiceIntentRequest, 'transcript' | 'alternatives' | 'available'> = {
    transcript,
    alternatives: others.slice(0, VOICE_LIMITS.alternatives),
    available: [...available],
  };
  const outcome = await deps.call(request, { signal });
  const record = toVoiceExchangeRecord(request, outcome);
  if (record) deps.record?.(record);

  const { result } = outcome;
  if (result.kind === 'aborted') return { kind: 'aborted' };
  if (result.kind !== 'ok') return { kind: 'failed', failure: result.kind };
  if (result.validationOutcome === 'invalid_output') {
    return { kind: 'failed', failure: 'invalid_output' };
  }
  const action = result.action;
  if (action === 'unknown' || !available.includes(action)) return { kind: 'unknown' };
  return {
    kind: 'command',
    command:
      action === 'rest_extend' ? { action, seconds: extendSeconds(words(transcript)) } : { action },
  };
}

/**
 * One voice call as a diagnostics row. The heard phrase is kept, on the
 * phone only, like the chat's questions: it is what makes "why did it do
 * that?" answerable. A cancelled call leaves no row.
 */
export function toVoiceExchangeRecord(
  request: Pick<VoiceIntentRequest, 'transcript' | 'alternatives' | 'available'>,
  call: VoiceCallOutcome,
): ExchangeRecord | null {
  const { result } = call;
  if (result.kind === 'aborted') return null;
  const ok = result.kind === 'ok';
  return {
    kind: 'voice_intent',
    requestId: call.requestId,
    promptVersion: ok ? result.promptVersion : null,
    model: ok ? result.model : null,
    latencyMs: call.latencyMs,
    tokensIn: ok ? result.usage.inputTokens : null,
    tokensOut: ok ? result.usage.outputTokens : null,
    attempts: 1,
    outcome: ok ? result.validationOutcome : result.kind,
    request,
    response: result,
  };
}
