import type { CoachContext } from '@/ai/contract/coachContext';
import type { WeeklySummary } from '@/ai/contract/weeklySummary';

import { buildJudgePrompt, judgeOutputSchema, type JudgeScores } from './rubric';

/** Sends one prompt to the judge model and returns its raw text. Injected, so the judge is testable. */
export type JudgeGenerate = (prompt: { instructions: string; prompt: string }) => Promise<string>;

export type JudgeResult =
  { kind: 'scored'; scores: JudgeScores } | { kind: 'unreadable'; reason: string };

/**
 * A model grading its own writing is known to rate it too kindly, so the
 * judge and the author must differ (research R8). This is a guard, not a
 * suggestion: judging with the author's own model throws.
 */
export function assertIndependentJudge(judgeModelId: string, authorModelId: string | null): void {
  if (authorModelId !== null && judgeModelId === authorModelId) {
    throw new Error(`The judge (${judgeModelId}) must not be the model that wrote the answers.`);
  }
}

/** Models often wrap JSON in a code fence even when told not to. */
function unfence(text: string): string {
  const match = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return (match ? match[1]! : text).trim();
}

export async function judgeAnswer(
  generate: JudgeGenerate,
  context: CoachContext,
  answer: WeeklySummary,
): Promise<JudgeResult> {
  const raw = await generate(buildJudgePrompt(context, answer));

  let json: unknown;
  try {
    json = JSON.parse(unfence(raw));
  } catch {
    return { kind: 'unreadable', reason: 'not JSON' };
  }
  const parsed = judgeOutputSchema.safeParse(json);
  return parsed.success
    ? { kind: 'scored', scores: parsed.data }
    : { kind: 'unreadable', reason: `${parsed.error.issues.length} schema issue(s)` };
}
