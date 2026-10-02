import type { ChatFacts } from '../contract/chat';
import type { CoachContext } from '../contract/coachContext';

/**
 * The few facts that ride with every request. They come from the same
 * context the weekly summary is built from, so the signals the chat is
 * told and the signals the summary is told cannot disagree.
 */
export function factsFromContext(context: CoachContext): ChatFacts {
  return {
    asOf: context.asOf,
    historicalSessionCount: context.historicalSessionCount,
    signals: context.signals,
    constraints: context.constraints,
  };
}
