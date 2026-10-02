import type { TurnFailure } from '@/ai/chat/runTurn';
import { pl } from '@/strings/pl';

import { describeFailure, type FailureView } from '../summaryErrors';

/**
 * Every way a chat turn can fail, as something a person can read. The two
 * failures only the loop knows come first; the rest are the transport's,
 * with the same sentences the weekly summary uses. Because it ends in the
 * exhaustive switch of `describeFailure`, a new `kind` fails the typecheck
 * here until it has a sentence.
 *
 * Returns null for `aborted`: pressing Stop is not a failure to report.
 */
export function describeTurnFailure(failure: TurnFailure): FailureView | null {
  switch (failure.kind) {
    case 'tool_limit':
      return { text: pl.coach.chat.errors.toolLimit, canRetry: true };
    case 'empty_reply':
      return { text: pl.coach.chat.errors.emptyReply, canRetry: true };
    default:
      return describeFailure(failure);
  }
}
