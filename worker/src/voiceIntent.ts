import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from 'ai';

import {
  UNKNOWN,
  type VoiceIntent,
  type VoiceIntentRequest,
  voiceIntentOutputSchema,
} from '../../src/ai/contract/voiceIntent';
import { buildVoiceIntentPrompt } from '../../src/ai/prompts/voiceIntent/v1';
import type { CallProviderOptions } from './model';
import { modelIdOf, type Tally } from './weeklySummary';

export interface VoiceGeneration {
  action: VoiceIntent;
  /** False when the model's answer could not be read and `unknown` stands in for it. */
  valid: boolean;
  modelId: string;
}

interface Options {
  abortSignal?: AbortSignal;
  maxOutputTokens: number;
  tally: Tally;
  providerOptions?: CallProviderOptions;
}

/**
 * A phrase in, one of the offered actions (or `unknown`) out, in one call.
 *
 * No repair round: the person is waiting mid-set, and a second call to fix a
 * malformed answer would double the wait for what is, at worst, "say it
 * again". An answer that cannot be read is `unknown`, and the response says
 * it was not valid so the log can count it.
 *
 * The output schema is built from the request, so an action the screen does
 * not offer is not even in the enum the provider fills. The check after
 * parsing repeats it anyway: the schema is the provider's promise, this is
 * ours.
 */
export async function generateVoiceIntent(
  model: LanguageModel,
  request: Pick<VoiceIntentRequest, 'transcript' | 'alternatives' | 'available'>,
  options: Options,
): Promise<VoiceGeneration> {
  const built = buildVoiceIntentPrompt(request);
  try {
    const result = await generateText({
      model,
      instructions: built.instructions,
      prompt: built.prompt,
      output: Output.object({ schema: voiceIntentOutputSchema(request.available) }),
      temperature: 0,
      maxRetries: 0,
      maxOutputTokens: options.maxOutputTokens,
      abortSignal: options.abortSignal,
      providerOptions: options.providerOptions,
    });
    options.tally.inputTokens += result.usage?.inputTokens ?? 0;
    options.tally.outputTokens += result.usage?.outputTokens ?? 0;
    const action = result.output.action;
    const offered = action === UNKNOWN || request.available.includes(action);
    return {
      action: offered ? action : UNKNOWN,
      valid: offered,
      modelId: result.response.modelId,
    };
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) throw error;
    options.tally.inputTokens += error.usage?.inputTokens ?? 0;
    options.tally.outputTokens += error.usage?.outputTokens ?? 0;
    return { action: UNKNOWN, valid: false, modelId: modelIdOf(model) };
  }
}
