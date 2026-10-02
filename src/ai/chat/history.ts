import { CHAT_LIMITS, type ChatMessage } from '../contract/chat';

/**
 * What the conversation remembers about a finished question: the question
 * and the answer, nothing else. The tool calls and results that led to the
 * answer are dropped. They are the biggest part of a conversation, they go
 * stale (a weight logged since would make an old result a wrong one), and
 * the model can look again if it needs to.
 */
export interface Exchange {
  user: string;
  assistant: string;
}

/** The earlier questions the model gets, newest last, no more than `rememberedTurns`. */
export function rememberTurn(
  history: readonly Exchange[],
  user: string,
  assistant: string,
): Exchange[] {
  return [...history, { user, assistant: assistant.slice(0, CHAT_LIMITS.replyChars) }].slice(
    -CHAT_LIMITS.rememberedTurns,
  );
}

export function historyMessages(history: readonly Exchange[]): ChatMessage[] {
  return history.flatMap((exchange): ChatMessage[] => [
    { role: 'user', text: exchange.user },
    { role: 'assistant', text: exchange.assistant, toolCalls: [] },
  ]);
}
