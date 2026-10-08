import { MockLanguageModelV4 } from 'ai/test';
import { fold } from '../../src/domain/coach/text';

/**
 * A stand-in model for running the app against a local Worker with no
 * provider key. Its answers are valid, obviously fake and never mistaken for
 * advice. Used only by `src/dev.ts`; the deployed entry point does not
 * import this file.
 *
 * For the chat it behaves like a model that needs one lookup: asked a
 * question, it requests a tool (the plan one when the question mentions the
 * plan, the weekly volume otherwise); shown the result, it streams an answer a
 * word at a time, slowly enough to watch, and notes in the log when the
 * Worker aborts it, so cancelling can be seen reaching the provider.
 */

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

/** Words of the streamed answer, with Polish letters so a split across chunks would show. */
const ANSWER = [
  'To ',
  'odpowiedź ',
  'atrapy, ',
  'nie ',
  'modelu. ',
  'Dane ',
  'sprawdziłem ',
  'na ',
  'Twoim ',
  'telefonie, ',
  'a ',
  'żadne ',
  'nie ',
  'wyszły ',
  'poza ',
  'Twój ',
  'komputer.',
];

const WORD_DELAY_MS = 220;

const log = (note: string) => console.log(JSON.stringify({ event: 'fake_provider', note }));

/** Resolves after `ms`, or at once when `signal` aborts. */
const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

type Part = Record<string, unknown>;

function streamOf(parts: Part[], signal: AbortSignal | undefined, delayMs: number) {
  return new ReadableStream({
    async start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      for (const part of parts) {
        await pause(delayMs, signal);
        if (signal?.aborted) {
          log('stream aborted by the Worker');
          controller.error(signal.reason);
          return;
        }
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

/** The latest message the person typed, whatever shape the SDK gives it. */
function lastUserMessage(prompt: readonly { role: string; content?: unknown }[]): unknown {
  return [...prompt].reverse().find((m) => m.role === 'user')?.content ?? null;
}

/**
 * The voice fallback: a phrase with the word "atrapa" in it picks the first
 * action offered, anything else is `unknown`. Obviously fake, and enough
 * to see both paths on the phone.
 */
function voiceAnswer(prompt: string) {
  // The prompt arrives JSON-encoded: its line breaks are the two characters \n.
  const first = /<available_actions>(?:\\n|\n)- ([a-z_]+):/.exec(prompt)?.[1];
  return { action: /atrapa/i.test(prompt) && first ? first : 'unknown' };
}

export function fakeModel() {
  const summary = {
    headline: 'To odpowiedź atrapy, nie modelu.',
    highlights: ['Tryb testowy: żadne dane nie wyszły poza Twój komputer.'],
    flags: [],
    questions: [],
  };
  return new MockLanguageModelV4({
    modelId: 'fake-coach',
    doGenerate: async (options) => {
      const text = JSON.stringify(options.prompt);
      const voice = /<available_actions>/.test(text);
      return {
        content: [{ type: 'text', text: JSON.stringify(voice ? voiceAnswer(text) : summary) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: voice ? usage(400, 5) : usage(1200, 80),
        warnings: [],
      };
    },
    doStream: async (options) => {
      const afterTool = options.prompt[options.prompt.length - 1]?.role === 'tool';
      const asksAboutPlan = /plan/i.test(JSON.stringify(lastUserMessage(options.prompt)));
      const question = fold(JSON.stringify(lastUserMessage(options.prompt)));
      const daysAhead = /pojutrze/.test(question) ? 2 : /jutro/.test(question) ? 1 : 0;
      const request = /uloz/.test(question)
        ? {
            name: 'proposeDayPlan',
            input: {
              days: [
                {
                  daysAhead,
                  slots: [
                    { slotId: 'push-horizontal' },
                    { slotId: 'pull-horizontal' },
                    { slotId: 'push-vertical', sets: 1 },
                  ],
                },
              ],
              note: 'Góra ciała na prośbę.',
            },
          }
        : /opcj/.test(question)
          ? { name: 'getDayOptions', input: { daysAhead } }
          : /dodatkow/.test(question)
            ? {
                name: 'proposeExtraSession',
                input: { focusMuscles: /klatk/.test(question) ? ['chest'] : ['calves'] },
              }
            : /zakwas/.test(question) && /pomin|przelicz|zmien/.test(question)
              ? {
                  name: 'proposePlanChange',
                  input: {
                    constraints: [
                      {
                        kind: 'avoid_muscle',
                        muscles: ['quads', 'hamstrings', 'glutes', 'calves'],
                        fromDaysAhead: 0,
                        days: 2,
                        reason: 'doms',
                        domsLevel: 4,
                      },
                    ],
                    note: 'Silne zakwasy nóg.',
                  },
                }
              : /woln/.test(question)
                ? {
                    name: 'proposePlanChange',
                    input: {
                      constraints: [
                        {
                          kind: 'rest_day',
                          muscles: [],
                          fromDaysAhead: daysAhead,
                          days: 1,
                          reason: 'busy',
                        },
                      ],
                      note: 'Dzień wolny na prośbę.',
                    },
                  }
                : /tygod|tydzien/.test(question) && asksAboutPlan
                  ? { name: 'getWeekPlan', input: {} }
                  : {
                      name: asksAboutPlan ? 'getPlanExplanation' : 'getWeeklyVolume',
                      input: asksAboutPlan ? { daysAgo: 0 } : { weeksAgo: 0 },
                    };
      const parts: Part[] = afterTool
        ? [
            { type: 'text-start', id: 't1' },
            ...ANSWER.map((delta) => ({ type: 'text-delta', id: 't1', delta })),
            { type: 'text-end', id: 't1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: usage(1500, ANSWER.length),
            },
          ]
        : [
            {
              type: 'tool-call',
              toolCallId: `fake-${options.prompt.length}`,
              toolName: request.name,
              input: JSON.stringify(request.input),
            },
            {
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
              usage: usage(1100, 20),
            },
          ];
      return {
        stream: streamOf(parts, options.abortSignal, afterTool ? WORD_DELAY_MS : 400) as never,
      };
    },
  });
}
