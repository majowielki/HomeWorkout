import type { TurnOutcome } from '../chat/runTurn';
import type { ChatFacts } from '../contract/chat';
import type { CoachContext } from '../contract/coachContext';
import type { CallOutcome } from './coachClient';

/** What gets stored for one call: the columns of `ai_exchanges`, minus the id and the time. */
export interface ExchangeRecord {
  kind: 'weekly_summary' | 'chat' | 'voice_intent';
  requestId: string;
  promptVersion: string | null;
  model: string | null;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  attempts: number;
  /** `ok` / `ok_after_repair` on success, otherwise the failure kind. */
  outcome: string;
  /** The context for a summary; the facts and the conversation for a chat turn. */
  request: unknown;
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

/**
 * One question to the chat, as a row: the facts and the conversation the
 * model saw, and what came of it. Kept on the phone only, like the rest.
 *
 * Two kinds of turn leave no row. A cancelled one is not an event worth
 * keeping. A blocked one never left the phone, and its text is by
 * definition the kind the app refuses to pass on (a complaint, a question
 * about diet or medication): storing it here would be keeping it anyway.
 */
export function toChatExchangeRecord(facts: ChatFacts, turn: TurnOutcome): ExchangeRecord | null {
  if (turn.kind === 'aborted' || turn.kind === 'blocked') return null;

  const outcome =
    turn.kind === 'answered'
      ? turn.truncated
        ? 'truncated'
        : 'ok'
      : turn.kind === 'withheld'
        ? 'withheld'
        : turn.failure.kind;
  const answer =
    turn.kind === 'answered'
      ? { text: turn.text }
      : turn.kind === 'withheld'
        ? { withheld: turn.text, violations: turn.violations }
        : { failure: turn.failure, partialText: turn.partialText };

  return {
    kind: 'chat',
    requestId: turn.requestIds[0] ?? '',
    promptVersion: turn.promptVersion,
    model: turn.model,
    latencyMs: turn.latencyMs,
    tokensIn: turn.usage.inputTokens,
    tokensOut: turn.usage.outputTokens,
    // Model steps: one more than the tool rounds.
    attempts: turn.requestIds.length,
    outcome,
    request: { facts, messages: turn.messages },
    response: { ...answer, tools: turn.tools, rounds: turn.rounds, requestIds: turn.requestIds },
  };
}
