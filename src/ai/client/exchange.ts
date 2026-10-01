import type { CoachContext } from '../contract/coachContext';
import type { CallOutcome } from './coachClient';

/** What gets stored for one call: the columns of `ai_exchanges`, minus the id and the time. */
export interface ExchangeRecord {
  kind: 'weekly_summary';
  requestId: string;
  promptVersion: string | null;
  model: string | null;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  attempts: number;
  /** `ok` / `ok_after_repair` on success, otherwise the failure kind. */
  outcome: string;
  request: CoachContext;
  response: unknown;
}

/**
 * One call, as a row. Returns null for a call that was cancelled: the
 * person walking away is not an event worth keeping.
 *
 * Both the request (the context that was sent) and the response are kept,
 * in full, on the phone only. That is what the diagnostics screen shows,
 * and what makes "why did it say that?" answerable.
 */
export function toExchangeRecord(context: CoachContext, call: CallOutcome): ExchangeRecord | null {
  const { result } = call;
  if (result.kind === 'aborted') return null;

  const base = {
    kind: 'weekly_summary' as const,
    requestId: call.requestId,
    latencyMs: call.latencyMs,
    attempts: call.attempts,
    request: context,
    response: result,
  };

  if (result.kind === 'ok') {
    return {
      ...base,
      promptVersion: result.promptVersion,
      model: result.model,
      tokensIn: result.usage.inputTokens,
      tokensOut: result.usage.outputTokens,
      outcome: result.validationOutcome,
    };
  }
  if (result.kind === 'invalid_output') {
    return {
      ...base,
      promptVersion: result.promptVersion,
      model: null,
      tokensIn: result.usage.inputTokens,
      tokensOut: result.usage.outputTokens,
      outcome: result.kind,
    };
  }
  return {
    ...base,
    promptVersion: null,
    model: null,
    tokensIn: null,
    tokensOut: null,
    outcome: result.kind,
  };
}
