import { checkReply, type GuardViolation } from '@/domain/coach/outputGuards';

import type { StreamEnd } from '../client/chatClient';
import type { ClientFailure } from '../client/coachClient';
import type { Usage } from '../contract/api';
import {
  CHAT_LIMITS,
  type ChatEvent,
  type ChatFacts,
  type ChatMessage,
  type ChatRequest,
  isSparseHistory,
  type ToolCall,
  type ToolResult,
} from '../contract/chat';
import type { ToolName } from '../contract/chatTools';
import { CONTRACT_VERSION } from '../contract/versions';
import { type Gate, gateUserText } from './gate';
import { type Exchange, historyMessages, rememberTurn } from './history';

/** Everything that can go wrong with a turn: the transport's failures, plus two of the loop's own. */
export type TurnFailure =
  | ClientFailure
  /** The model kept asking for tools past the limit the Worker enforces. */
  | { kind: 'tool_limit' }
  /** The model finished and said nothing. */
  | { kind: 'empty_reply' };

/** What happened, for the local log and the diagnostics screen. Counts and names, never more than was sent. */
export interface TurnMeta {
  requestIds: string[];
  promptVersion: string | null;
  model: string | null;
  /** Tool rounds the question used. */
  rounds: number;
  /** Tools run, in order. */
  tools: ToolName[];
  usage: Usage;
  latencyMs: number;
  /** The conversation as the model saw it for this question. */
  messages: ChatMessage[];
}

export type TurnOutcome = TurnMeta &
  /** The message never left the phone. The reply to show is the app's own. */
  (
    | { kind: 'blocked'; gate: Exclude<Gate, { kind: 'pass' }> }
    | {
        kind: 'answered';
        text: string;
        /** The model ran out of room or was cut off: the text is real but unfinished. */
        truncated: boolean;
        /** The conversation to carry into the next question. */
        history: Exchange[];
      }
    /** The reply broke a rule after it had streamed. The person sees the app's sentence instead. */
    | { kind: 'withheld'; violations: GuardViolation['kind'][]; text: string }
    | { kind: 'failed'; failure: TurnFailure; partialText: string }
    | { kind: 'aborted' }
  );

export interface TurnListener {
  /** Text as it streams, across every step of the turn. */
  onText?: (delta: string) => void;
  onToolStart?: (call: ToolCall) => void;
  onToolDone?: (call: ToolCall, result: ToolResult) => void;
}

export interface TurnInput {
  facts: ChatFacts;
  /** The questions before this one. */
  history: readonly Exchange[];
  text: string;
  signal?: AbortSignal;
  listener?: TurnListener;
}

export interface TurnDeps {
  stream: (
    request: ChatRequest,
    options: { signal?: AbortSignal; onEvent: (event: ChatEvent) => void },
  ) => Promise<StreamEnd>;
  /** Runs one tool on the phone's own data. Never throws: a failure is a tool result. */
  executeTool: (call: ToolCall) => Promise<ToolResult>;
  newRequestId: () => string;
  now: () => number;
}

interface Step {
  text: string;
  calls: ToolCall[];
  finishReason: Extract<ChatEvent, { type: 'finish' }>['reason'] | null;
}

/**
 * One question, from the person's words to a vetted answer.
 *
 * The loop the plan calls the agent loop (F4): ask the Worker for one
 * model step; if the model wants tools, run them here, on the phone, and
 * ask again with the results; otherwise the step's text is the answer.
 * Every limit is on the phone's side of the wire as well as the Worker's.
 *
 * Nothing is sent for a message the text gate stops. A reply is shown as
 * it streams, so the check on what it said comes after the fact: a reply
 * that breaks a rule is withheld and the conversation does not remember it
 * (I1, I4, I5). There is no repair as in the weekly summary; the person
 * can ask again.
 *
 * Cancelling stops at once, between steps and between tool runs too.
 */
export async function runTurn(input: TurnInput, deps: TurnDeps): Promise<TurnOutcome> {
  const started = deps.now();
  const { facts, signal, listener } = input;

  const gate = gateUserText(input.text);
  const meta: TurnMeta = {
    requestIds: [],
    promptVersion: null,
    model: null,
    rounds: 0,
    tools: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    latencyMs: 0,
    messages: [],
  };
  const done = <T extends object>(rest: T): TurnMeta & T => ({
    ...meta,
    latencyMs: deps.now() - started,
    ...rest,
  });
  if (gate.kind !== 'pass') return done({ kind: 'blocked' as const, gate });

  const messages: ChatMessage[] = [
    ...historyMessages(input.history),
    { role: 'user', text: gate.text },
  ];
  meta.messages = messages;
  let shown = '';

  for (;;) {
    const step: Step = { text: '', calls: [], finishReason: null };
    const requestId = deps.newRequestId();
    meta.requestIds.push(requestId);

    const end = await deps.stream(
      { contractVersion: CONTRACT_VERSION, requestId, facts, messages },
      {
        signal,
        onEvent(event) {
          switch (event.type) {
            case 'start':
              meta.promptVersion = event.promptVersion;
              meta.model = event.model;
              break;
            case 'text': {
              // A new step continues the sentence the last one began; keep the words apart.
              const gap = step.text === '' && shown !== '' && !/\s$/.test(shown) ? '\n' : '';
              step.text += event.delta;
              shown += gap + event.delta;
              listener?.onText?.(gap + event.delta);
              break;
            }
            case 'tool_call':
              step.calls.push(event.call);
              listener?.onToolStart?.(event.call);
              break;
            case 'finish':
              step.finishReason = event.reason;
              meta.usage.inputTokens += event.usage.inputTokens;
              meta.usage.outputTokens += event.usage.outputTokens;
              break;
            case 'error':
              break;
          }
        },
      },
    );

    if (end.kind === 'failed') {
      return end.failure.kind === 'aborted'
        ? done({ kind: 'aborted' as const })
        : done({ kind: 'failed' as const, failure: end.failure, partialText: shown });
    }

    // --- the model asked for tools -----------------------------------------------
    if (step.finishReason === 'tool_calls' || step.calls.length > 0) {
      if (step.calls.length === 0) {
        return done({
          kind: 'failed' as const,
          failure: { kind: 'protocol_error' as const },
          partialText: shown,
        });
      }
      if (meta.rounds >= CHAT_LIMITS.toolRounds) {
        return done({
          kind: 'failed' as const,
          failure: { kind: 'tool_limit' as const },
          partialText: shown,
        });
      }
      meta.rounds += 1;

      const calls = step.calls.slice(0, CHAT_LIMITS.callsPerRound);
      messages.push({ role: 'assistant', text: step.text, toolCalls: calls });
      const results: ToolResult[] = [];
      for (const call of calls) {
        if (signal?.aborted) return done({ kind: 'aborted' as const });
        const result = await deps.executeTool(call);
        meta.tools.push(call.name);
        listener?.onToolDone?.(call, result);
        results.push(result);
      }
      messages.push({ role: 'tool', results });
      continue;
    }

    // --- the model answered ----------------------------------------------------
    // Words before a tool call do not make an answer: a step that follows the results must say something.
    if (step.text.trim() === '') {
      return done({
        kind: 'failed' as const,
        failure: { kind: 'empty_reply' as const },
        partialText: shown,
      });
    }
    const text = shown.trim();
    const violations = checkReply(text, { sparse: isSparseHistory(facts) });
    if (violations.length > 0) {
      return done({ kind: 'withheld' as const, violations: violations.map((v) => v.kind), text });
    }

    messages.push({ role: 'assistant', text: step.text, toolCalls: [] });
    return done({
      kind: 'answered' as const,
      text,
      truncated: step.finishReason !== 'stop',
      history: rememberTurn(input.history, gate.text, text),
    });
  }
}
