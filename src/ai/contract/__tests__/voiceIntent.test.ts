import { CONTRACT_VERSION } from '../versions';
import {
  voiceIntentOutputSchema,
  voiceIntentRequestSchema,
  voiceIntentResponseSchema,
} from '../voiceIntent';

const request = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: CONTRACT_VERSION,
  requestId: 'req-voice-0001',
  transcript: 'lecimy',
  alternatives: [],
  available: ['rest_end'],
  ...overrides,
});

describe('the voice-intent contract', () => {
  it('accepts a request and refuses repeats, unknown actions and long text', () => {
    expect(voiceIntentRequestSchema.safeParse(request()).success).toBe(true);
    for (const bad of [
      { available: ['rest_end', 'rest_end'] },
      { available: ['finish_workout'] },
      { transcript: 'x'.repeat(121) },
      { contractVersion: CONTRACT_VERSION + 1 },
    ]) {
      expect(voiceIntentRequestSchema.safeParse(request(bad)).success).toBe(false);
    }
  });

  it('lets the model name only an offered action or unknown', () => {
    const schema = voiceIntentOutputSchema(['rest_end', 'skip_exercise']);
    expect(schema.safeParse({ action: 'skip_exercise' }).success).toBe(true);
    expect(schema.safeParse({ action: 'unknown' }).success).toBe(true);
    expect(schema.safeParse({ action: 'set_done' }).success).toBe(false);
  });

  it('answers ok or one of the shared errors', () => {
    expect(voiceIntentResponseSchema.safeParse({ kind: 'timeout' }).success).toBe(true);
    expect(
      voiceIntentResponseSchema.safeParse({
        kind: 'ok',
        requestId: 'r',
        promptVersion: 'voice-intent/v1',
        model: 'm',
        usage: { inputTokens: 1, outputTokens: 1 },
        action: 'rest_end',
        validationOutcome: 'ok',
      }).success,
    ).toBe(true);
  });
});
