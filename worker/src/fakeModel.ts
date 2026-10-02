import { MockLanguageModelV4 } from 'ai/test';

/**
 * A stand-in model for running the app against a local Worker with no
 * provider key. Its answers are valid, obviously fake and never mistaken for
 * advice. Used only by `src/dev.ts`; the deployed entry point does not
 * import this file.
 *
 * For the chat it behaves like a model that needs one lookup: asked a
 * question, it requests a tool; shown the result, it streams an answer a
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

export function fakeModel() {
  const summary = {
    headline: 'To odpowiedź atrapy, nie modelu.',
    highlights: ['Tryb testowy: żadne dane nie wyszły poza Twój komputer.'],
    flags: [],
    questions: [],
  };
  return new MockLanguageModelV4({
    modelId: 'fake-coach',
    doGenerate: {
      content: [{ type: 'text', text: JSON.stringify(summary) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: usage(1200, 80),
      warnings: [],
    },
    doStream: async (options) => {
      const afterTool = options.prompt[options.prompt.length - 1]?.role === 'tool';
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
              toolName: 'getWeeklyVolume',
              input: JSON.stringify({ weeksAgo: 0 }),
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
