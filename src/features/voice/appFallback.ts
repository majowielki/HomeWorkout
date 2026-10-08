import type { ExchangeRecord } from '@/ai/client/exchange';
import { createVoiceIntentClient } from '@/ai/client/voiceIntentClient';
import { askVoiceFallback, type FallbackOutcome } from '@/ai/voice/fallback';
import { recordExchange } from '@/db/repositories/aiExchanges';
import type { VoiceActionId } from '@/domain/voice/commands';
import { getAiEnabled } from '@/lib/aiSettings';
import { coachConfig, newRequestId } from '@/lib/coach';

export type VoiceFallback = (
  alternatives: readonly string[],
  available: readonly VoiceActionId[],
  signal: AbortSignal,
) => Promise<FallbackOutcome>;

/**
 * The voice fallback, when the AI switch is on and there is a server to ask:
 * the phrase the phone did not understand goes to the model, and the
 * exchange is kept in the on-phone diagnostics log like every other call.
 * Null otherwise, and the bar simply says it did not understand.
 */
export function createAppVoiceFallback(): VoiceFallback | null {
  if (!coachConfig || !getAiEnabled()) return null;
  const call = createVoiceIntentClient(coachConfig, { newRequestId });
  const record = (exchange: ExchangeRecord) => {
    void recordExchange(exchange).catch((error: unknown) => {
      console.warn('could not keep the voice exchange', error);
    });
  };
  return (alternatives, available, signal) =>
    askVoiceFallback(alternatives, available, { call, record }, signal);
}
