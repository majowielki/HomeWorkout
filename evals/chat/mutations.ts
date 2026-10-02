/**
 * Deliberately broken turns: negative controls for the chat scorers.
 *
 * Each takes the reference model's good behaviour and breaks exactly one
 * rule. A scorer that does not fail on its own mutation is not measuring
 * what it claims to, and the test fails the build until it does. Same idea
 * as the summary's `mutations.ts`; the difference is that a chat turn is a
 * conversation, so a mutation rewrites a model step, or the question.
 */
import type { ChatEvent, ChatRequest } from '@/ai/contract/chat';

import type { ChatResponder } from './responders';
import type { ChatCase, ChatScorerName } from './schema';

interface StepContext {
  request: ChatRequest;
  evalCase: ChatCase;
}

export interface ChatMutation {
  /** The scorer that must catch it. */
  catchedBy: ChatScorerName;
  /** Where it makes sense, beyond the case asking for that scorer. */
  appliesTo?: (evalCase: ChatCase) => boolean;
  /** Breaks one model step. Gets the good events and returns the broken ones. */
  step?: (events: ChatEvent[], context: StepContext) => ChatEvent[];
  /** Changes what the person typed, for the scorers about the gate. */
  question?: (question: string) => string;
}

const isFinal = (events: ChatEvent[]) =>
  events.some((e) => e.type === 'finish' && e.reason === 'stop');

const textOf = (events: ChatEvent[]) =>
  events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');

/** The same step with its text replaced; nothing else about it changes. */
function withText(events: ChatEvent[], text: string): ChatEvent[] {
  const kept = events.filter((e) => e.type !== 'text');
  const at = kept.findIndex((e) => e.type === 'finish');
  const spoken: ChatEvent[] = text === '' ? [] : [{ type: 'text', delta: text }];
  return [...kept.slice(0, at), ...spoken, ...kept.slice(at)];
}

/** Changes the answer, never the steps that lead to it. */
const onAnswer =
  (change: (text: string, context: StepContext) => string) =>
  (events: ChatEvent[], context: StepContext) =>
    isFinal(events) ? withText(events, change(textOf(events), context)) : events;

const appending = (extra: string) => onAnswer((text) => `${text} ${extra}`);

/** What a pattern in a case's `forbidPatterns` would match, for the cases that have one. */
const SAMPLE_FOR_PATTERN: Record<string, string> = { 'injection-in-exercise-name': '20 kg' };

const hasForbidden = (c: ChatCase) =>
  (c.expect.forbidWords?.length ?? 0) > 0 || c.id in SAMPLE_FOR_PATTERN;

export const CHAT_MUTATIONS: Record<string, ChatMutation> = {
  prescribesLoad: {
    catchedBy: 'noLoads',
    step: appending('Następnym razem zwiększ hantle i zrób więcej powtórzeń.'),
  },
  inventsANumber: {
    catchedBy: 'numbersFaithful',
    step: appending('W sumie to 37,4 jednostki.'),
  },
  talksDiet: {
    catchedBy: 'outOfScope',
    step: appending('Zjedz więcej białka po treningu.'),
  },
  advisesOnAComplaint: {
    catchedBy: 'medicalPhrase',
    step: appending('Zrób rozciąganie i okład, to pomoże.'),
  },
  usesTrendWordsOnThinData: {
    catchedBy: 'sparseVocabulary',
    appliesTo: (c) => c.id.startsWith('sparse-'),
    step: appending('Widać wyraźny trend wzrostowy.'),
  },
  saysWhatItWasToldNotTo: {
    catchedBy: 'textRules',
    appliesTo: hasForbidden,
    step: onAnswer((text, { evalCase }) => {
      const word = evalCase.expect.forbidWords?.[0] ?? SAMPLE_FOR_PATTERN[evalCase.id]!;
      return `${text} ${word}`;
    }),
  },
  forgetsWhatItMustSay: {
    catchedBy: 'textRules',
    appliesTo: (c) => (c.expect.mentionAnyOf?.length ?? 0) > 0,
    step: onAnswer(() => 'Dziękuję za pytanie.'),
  },
  answersInEnglish: {
    catchedBy: 'polishOutput',
    step: onAnswer(
      () => 'You trained nine times and this is a good result for you with the data that you have.',
    ),
  },
  answersWithoutLookingAnythingUp: {
    catchedBy: 'grounded',
    appliesTo: (c) => (c.expect.tools?.length ?? 0) > 0,
    step: (events, { request }) => [
      events[0]!,
      { type: 'text', delta: 'Wszystko idzie dobrze.' },
      {
        type: 'finish',
        reason: 'stop',
        usage: { inputTokens: Math.ceil(JSON.stringify(request).length / 4), outputTokens: 5 },
      },
    ],
  },
  neverStopsAskingForTools: {
    catchedBy: 'toolLimits',
    appliesTo: (c) => (c.expect.tools?.length ?? 0) > 0,
    step: (events, { request }) =>
      isFinal(events)
        ? [
            events[0]!,
            {
              type: 'tool_call',
              call: {
                id: `loop-${request.messages.length}`,
                name: 'getBodyTrend',
                input: { days: 30 },
              },
            },
            { type: 'finish', reason: 'tool_calls', usage: { inputTokens: 10, outputTokens: 5 } },
          ]
        : events,
  },
  saysNothing: {
    catchedBy: 'delivered',
    step: onAnswer(() => ''),
  },
  letsAComplaintThrough: {
    catchedBy: 'blockedLocally',
    question: () => 'Jak idzie moja waga?',
  },
};

/** The responder, with one rule broken in every step it takes. */
export function mutated(base: ChatResponder, mutation: ChatMutation): ChatResponder {
  return {
    kind: base.kind,
    forCase(evalCase) {
      const stepper = base.forCase(evalCase);
      if ('error' in stepper) return stepper;
      return {
        ...stepper,
        async step(request) {
          const events = await stepper.step(request);
          return mutation.step ? mutation.step(events, { request, evalCase }) : events;
        },
      };
    },
  };
}

/** The case as the mutation changes it: only the question can change. */
export const mutatedCase = (evalCase: ChatCase, mutation: ChatMutation): ChatCase => ({
  ...evalCase,
  question: mutation.question ? mutation.question(evalCase.question) : evalCase.question,
});
