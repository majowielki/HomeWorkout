import {
  jsonSchema,
  streamText,
  tool,
  type LanguageModel,
  type ModelMessage,
  type Schema,
  type ToolSet,
} from 'ai';
import { z } from 'zod';

import {
  CHAT_LIMITS,
  type ChatEvent,
  type ChatMessage,
  type ChatRequest,
  type FinishReason,
  isSparseHistory,
  toolRoundsUsed,
} from '../../src/ai/contract/chat';
import { CHAT_TOOLS, TOOL_NAMES, type ToolName } from '../../src/ai/contract/chatTools';
import { buildChatPrompt } from '../../src/ai/prompts/chat/v7';
import { checkReply } from '../../src/domain/coach/outputGuards';
import type { CallProviderOptions } from './model';
import { modelIdOf, type Tally } from './weeklySummary';
import { messagesReportPain } from './reportedPain';
import { MEDICAL_REFERRAL } from '../../src/ai/prompts/weeklySummary/v1';

export const CHAT_TEMPERATURE = 0.3;

/**
 * The model asked for something the Worker cannot hand to the phone: a tool
 * that does not exist, or arguments that do not parse. Providers that
 * constrain the call to declared tools make this rare; when it happens the
 * turn fails as an invalid answer rather than sending the phone a call it
 * cannot name in the next request.
 */
export class InvalidToolCallError extends Error {}

const CHANGE_KINDS = [
  'add_exercise',
  'add_sets',
  'swap_remaining',
  'reduce_remaining',
  'skip_remaining',
  'feel',
] as const;
const INPUT_FIELDS = [
  'kind',
  'exposureId',
  'dropSets',
  'easier',
  'sets',
  'query',
  'placement',
  'feel',
  'assessmentId',
  'patchId',
  'weeksAgo',
] as const;

/** Only schema names and known enums; never values or model-supplied key names. */
export function invalidToolMetadata(name: string, input: unknown) {
  const data =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  return {
    name: (TOOL_NAMES as readonly string[]).includes(name) ? name : 'unknown',
    kind: (CHANGE_KINDS as readonly unknown[]).includes(data.kind)
      ? (data.kind as string)
      : 'unknown',
    fields: INPUT_FIELDS.filter((field) => Object.hasOwn(data, field)),
    extraFields: Object.keys(data).filter(
      (field) => !(INPUT_FIELDS as readonly string[]).includes(field),
    ).length,
  };
}

/**
 * What a step did, filled in as it streams, for the log. Counts only: the
 * text of the reply and the arguments of a call never leave this module.
 */
export interface StepStats {
  finishReason: FinishReason;
  /** What the provider itself reported (for Gemini: STOP, MAX_TOKENS, SAFETY, ...). A code, never text. */
  rawFinishReason: string | undefined;
  toolCalls: number;
  /** Calls beyond the per-round cap, asked for by the model and ignored. */
  droppedCalls: number;
  replyChars: number;
  guardViolations: number;
  /** Tokens the model spent thinking; they are part of the output tokens and are billed as such. */
  reasoningTokens: number;
}

export const newStats = (): StepStats => ({
  finishReason: 'other',
  rawFinishReason: undefined,
  toolCalls: 0,
  droppedCalls: 0,
  replyChars: 0,
  guardViolations: 0,
  reasoningTokens: 0,
});

/**
 * The conversation the phone sent, as the SDK's messages. Tool results go
 * back as JSON, the form every provider adapter understands.
 */
export function toModelMessages(messages: readonly ChatMessage[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    switch (message.role) {
      case 'user':
        return { role: 'user', content: message.text };
      case 'assistant':
        return {
          role: 'assistant',
          content: [
            ...(message.text === '' ? [] : [{ type: 'text' as const, text: message.text }]),
            ...message.toolCalls.map((call) => ({
              type: 'tool-call' as const,
              toolCallId: call.id,
              toolName: call.name,
              input: call.input,
            })),
          ],
        };
      case 'tool':
        return {
          role: 'tool',
          content: message.results.map((result) => ({
            type: 'tool-result' as const,
            toolCallId: result.callId,
            toolName: result.name,
            output: { type: 'json' as const, value: result.output },
          })),
        };
    }
  });
}

/**
 * The tools as the model sees them. None has an `execute`: a call ends the
 * step and is handed back to the phone, which runs it on its own data.
 */
export function chatTools(): ToolSet {
  return Object.fromEntries(
    TOOL_NAMES.map((name) => {
      const input: z.ZodType = CHAT_TOOLS[name].input;
      return [
        name,
        tool({
          description: CHAT_TOOLS[name].description,
          // Google normalizes const for response schemas, but not function schemas.
          // Draft 4 expresses literals as enum; validation still uses the exact Zod contract.
          inputSchema: jsonSchema(
            () =>
              z.toJSONSchema(input, { target: 'draft-4', io: 'input' }) as Awaited<
                Schema['jsonSchema']
              >,
            {
              validate: async (value) => {
                const parsed = await input.safeParseAsync(value);
                return parsed.success
                  ? { success: true, value: parsed.data }
                  : { success: false, error: parsed.error };
              },
            },
          ),
        }),
      ];
    }),
  );
}

const FROM_SDK = {
  stop: 'stop',
  'tool-calls': 'tool_calls',
  length: 'length',
} as const;

interface StepOptions {
  abortSignal: AbortSignal;
  maxOutputTokens: number;
  tally: Tally;
  stats: StepStats;
  providerOptions?: CallProviderOptions;
}

/**
 * One model step of the chat, as events.
 *
 * The first event is `start`; then text and tool calls as they arrive; the
 * last is `finish`. A provider failure is thrown, not turned into an event
 * here: the route decides whether it can still be a plain error response
 * (nothing sent yet) or has to become an `error` event.
 *
 * After the last allowed tool round the tools stay declared but the model
 * is forbidden to call one (`toolChoice: 'none'`), so it has to answer with
 * what it has. The history may contain earlier calls, and a provider that
 * sees calls in the history but no tools may refuse the request.
 */
export async function* streamChatStep(
  model: LanguageModel,
  request: ChatRequest,
  options: StepOptions,
): AsyncGenerator<ChatEvent> {
  const { promptVersion, instructions } = buildChatPrompt(request.facts);
  const toolsAllowed = toolRoundsUsed(request.messages) < CHAT_LIMITS.toolRounds;

  const result = streamText({
    model,
    instructions,
    messages: toModelMessages(request.messages),
    tools: chatTools(),
    toolChoice: toolsAllowed ? 'auto' : 'none',
    temperature: CHAT_TEMPERATURE,
    // The app retries, on the flag the route returns. A second layer inside the SDK would hide latency and spend.
    maxRetries: 0,
    maxOutputTokens: options.maxOutputTokens,
    abortSignal: options.abortSignal,
    providerOptions: options.providerOptions,
    // The SDK would log a provider error, which can quote what was sent. Errors are handled below.
    onError: () => {},
  });

  yield { type: 'start', requestId: request.requestId, promptVersion, model: modelIdOf(model) };

  let reply = '';
  for await (const part of result.stream) {
    switch (part.type) {
      case 'text-delta':
        reply += part.text;
        yield { type: 'text', delta: part.text };
        break;

      case 'tool-call':
        if (part.invalid === true) {
          console.log(
            JSON.stringify({
              event: 'invalid_tool',
              ...invalidToolMetadata(part.toolName, part.input),
            }),
          );
          throw new InvalidToolCallError();
        }
        options.stats.toolCalls += 1;
        if (options.stats.toolCalls > CHAT_LIMITS.callsPerRound) {
          options.stats.droppedCalls += 1;
          break;
        }
        yield {
          type: 'tool_call',
          call: {
            id: part.toolCallId,
            name: part.toolName as ToolName,
            input: part.input as Record<string, never>,
          },
        };
        break;

      case 'error':
        throw part.error;

      case 'abort':
        return;

      case 'finish': {
        if (
          part.finishReason === 'stop' &&
          options.stats.toolCalls === 0 &&
          reply.trim() !== '' &&
          messagesReportPain(request.messages) &&
          !reply.includes(MEDICAL_REFERRAL)
        ) {
          const delta = ` ${MEDICAL_REFERRAL}`;
          reply += delta;
          yield { type: 'text', delta };
        }
        const usage = {
          inputTokens: part.totalUsage.inputTokens ?? 0,
          outputTokens: part.totalUsage.outputTokens ?? 0,
        };
        options.tally.inputTokens += usage.inputTokens;
        options.tally.outputTokens += usage.outputTokens;
        options.stats.reasoningTokens += part.totalUsage.outputTokenDetails?.reasoningTokens ?? 0;
        options.stats.finishReason =
          FROM_SDK[part.finishReason as keyof typeof FROM_SDK] ?? 'other';
        options.stats.replyChars = reply.length;
        // Measured, not enforced: the phone withdraws a reply that breaks a rule. This is how
        // the Worker's log shows how often that happens, without ever holding the text.
        options.stats.guardViolations = checkReply(reply, {
          sparse: isSparseHistory(request.facts),
        }).length;
        options.stats.rawFinishReason = part.rawFinishReason;
        yield { type: 'finish', reason: options.stats.finishReason, usage };
        break;
      }

      default:
        // Reasoning, sources, step boundaries: not part of what the phone shows.
        break;
    }
  }
}
