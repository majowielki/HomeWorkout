/**
 * F4 — the chat (AI-INTEGRACJA §3, decision D1).
 *
 * The Worker is stateless, so the phone sends the whole conversation with
 * every request and the Worker answers one model step: text, or a request
 * to run tools. The phone runs the tools and asks again. That loop, its
 * limits and the wire format are defined here.
 *
 * Wire format of an answer: newline-delimited JSON, one `ChatEvent` per
 * line. Problems found before the first byte (no secret, bad request) are
 * ordinary JSON `ApiError`s with a status code; once streaming has begun
 * the status is already 200, so a failure becomes an `error` event.
 *
 * Requests are checked more strictly than anything a model returns: this
 * is data the phone claims to have produced, and a malformed conversation
 * sent on to a provider comes back as an opaque upstream error.
 */
import { z } from 'zod';

import { CONSTRAINT_CODES, SIGNAL_CODES } from '../../domain/coach/vocabulary';
import { apiErrorSchema, usageSchema } from './api';
import { isoDate } from './coachContext';
import { TOOL_NAMES, toolResultSchemaFor } from './chatTools';
import { CONTRACT_VERSION } from './versions';

export const CHAT_LIMITS = {
  /** Characters in one message from the person. The composer stops here too. */
  userChars: 500,
  replyChars: 4000,
  /**
   * Times the model may ask for tools within one question. After the last
   * round the Worker takes the tools away, so the model must answer with
   * what it has. Enforced by the Worker (it counts the rounds in the
   * request) and again by the phone.
   */
  toolRounds: 4,
  callsPerRound: 3,
  /** Hard cap on the conversation the Worker accepts. */
  messages: 40,
  /**
   * Earlier questions the phone carries forward, as question and answer
   * only. Tool traffic is kept just for the question being answered.
   */
  rememberedTurns: 6,
} as const;

const callId = z.string().min(1).max(64);

export const toolCallSchema = z.strictObject({
  id: callId,
  name: z.enum(TOOL_NAMES),
  /** What the model asked with; checked against the tool's input schema where the tool runs. */
  input: z.record(z.string(), z.json()),
});

export type ToolCall = z.infer<typeof toolCallSchema>;

const toolResultSchema = z
  .strictObject({
    callId,
    name: z.enum(TOOL_NAMES),
    output: z.json(),
  })
  .superRefine((result, ctx) => {
    if (!toolResultSchemaFor(result.name).safeParse(result.output).success) {
      ctx.addIssue({ code: 'custom', path: ['output'], message: 'not what this tool returns' });
    }
  });

export type ToolResult = z.infer<typeof toolResultSchema>;

export const chatMessageSchema = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('user'), text: z.string().min(1).max(CHAT_LIMITS.userChars) }),
  z.strictObject({
    role: z.literal('assistant'),
    text: z.string().max(CHAT_LIMITS.replyChars),
    toolCalls: z.array(toolCallSchema).max(CHAT_LIMITS.callsPerRound),
  }),
  z.strictObject({
    role: z.literal('tool'),
    results: z.array(toolResultSchema).min(1).max(CHAT_LIMITS.callsPerRound),
  }),
]);

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/**
 * What the model must always know, whatever it decides to look up: the
 * date, and the facts that decide which words are allowed. Sent with every
 * request so a safety rule never depends on the model remembering to ask
 * (I5: thin history forbids trend vocabulary).
 */
export const chatFactsSchema = z.strictObject({
  asOf: isoDate,
  historicalSessionCount: z.number().int().nonnegative(),
  signals: z.array(z.enum(SIGNAL_CODES)),
  constraints: z.array(z.enum(CONSTRAINT_CODES)),
});

export type ChatFacts = z.infer<typeof chatFactsSchema>;

export type ConversationProblem =
  | 'empty'
  | 'order'
  | 'unanswered_calls'
  | 'results_do_not_match_calls'
  | 'duplicate_call_id'
  | 'too_many_rounds'
  | 'empty_reply'
  | 'ends_with_reply';

/**
 * Whether a list of messages is a conversation a model can continue.
 *
 * The grammar: a question, then any number of rounds (the assistant asks
 * for tools, a tool message answers exactly those calls), then optionally
 * the final reply; and again. It must end on a question or on tool
 * results, which is where a model is expected to speak next.
 */
export function conversationProblem(messages: readonly ChatMessage[]): ConversationProblem | null {
  if (messages.length === 0) return 'empty';

  type State = 'start' | 'asked' | 'calling' | 'answered' | 'replied';
  let state: State = 'start';
  let pending: ToolCall[] = [];
  let rounds = 0;
  const seen = new Set<string>();

  for (const message of messages) {
    if (message.role === 'user') {
      if (state !== 'start' && state !== 'replied')
        return state === 'calling' ? 'unanswered_calls' : 'order';
      state = 'asked';
      rounds = 0;
    } else if (message.role === 'assistant') {
      if (state !== 'asked' && state !== 'answered') return 'order';
      if (message.toolCalls.length === 0) {
        if (message.text.trim() === '') return 'empty_reply';
        state = 'replied';
      } else {
        rounds += 1;
        if (rounds > CHAT_LIMITS.toolRounds) return 'too_many_rounds';
        for (const call of message.toolCalls) {
          if (seen.has(call.id)) return 'duplicate_call_id';
          seen.add(call.id);
        }
        pending = message.toolCalls;
        state = 'calling';
      }
    } else {
      if (state !== 'calling') return 'order';
      const answered = new Map(message.results.map((r) => [r.callId, r.name]));
      const matches =
        message.results.length === pending.length &&
        answered.size === pending.length &&
        pending.every((call) => answered.get(call.id) === call.name);
      if (!matches) return 'results_do_not_match_calls';
      state = 'answered';
    }
  }

  if (state === 'calling') return 'unanswered_calls';
  if (state === 'replied') return 'ends_with_reply';
  return null;
}

/** Tool rounds already used by the question that is being answered. */
export function toolRoundsUsed(messages: readonly ChatMessage[]): number {
  let rounds = 0;
  for (const message of messages) {
    if (message.role === 'user') rounds = 0;
    else if (message.role === 'assistant' && message.toolCalls.length > 0) rounds += 1;
  }
  return rounds;
}

export const chatRequestSchema = z
  .strictObject({
    contractVersion: z.literal(CONTRACT_VERSION),
    requestId: z.string().min(8).max(64),
    facts: chatFactsSchema,
    messages: z.array(chatMessageSchema).max(CHAT_LIMITS.messages),
  })
  .superRefine((request, ctx) => {
    const problem = conversationProblem(request.messages);
    if (problem !== null) ctx.addIssue({ code: 'custom', path: ['messages'], message: problem });
  });

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Why the model stopped. `tool_calls` means "run these and ask again". */
export const FINISH_REASONS = ['stop', 'tool_calls', 'length', 'other'] as const;

export const chatEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('start'),
    requestId: z.string(),
    promptVersion: z.string(),
    model: z.string(),
  }),
  z.strictObject({ type: z.literal('text'), delta: z.string() }),
  z.strictObject({ type: z.literal('tool_call'), call: toolCallSchema }),
  z.strictObject({
    type: z.literal('finish'),
    reason: z.enum(FINISH_REASONS),
    usage: usageSchema,
  }),
  z.strictObject({ type: z.literal('error'), error: apiErrorSchema }),
]);

export type ChatEvent = z.infer<typeof chatEventSchema>;
