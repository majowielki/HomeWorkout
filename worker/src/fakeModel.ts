import { MockLanguageModelV4 } from 'ai/test';

/**
 * A stand-in model for running the app against a local Worker with no
 * provider key. Its answer is valid, obviously fake and never mistaken for
 * advice. Used only by `src/dev.ts`; the deployed entry point does not
 * import this file.
 */
export function fakeModel() {
  const answer = {
    headline: 'To odpowiedź atrapy, nie modelu.',
    highlights: ['Tryb testowy: żadne dane nie wyszły poza Twój komputer.'],
    flags: [],
    questions: [],
  };
  return new MockLanguageModelV4({
    modelId: 'fake-coach',
    doGenerate: {
      content: [{ type: 'text', text: JSON.stringify(answer) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1200, noCache: 1200, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 80, text: 80, reasoning: 0 },
      },
      warnings: [],
    },
  });
}
