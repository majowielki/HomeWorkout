import type { ChatMessage } from '../../src/ai/contract/chat';
import type { ToolOutput } from '../../src/ai/contract/chatTools';
import type { CoachContext } from '../../src/ai/contract/coachContext';
import type { WeeklySummary } from '../../src/ai/contract/weeklySummary';
import { MEDICAL_REFERRAL } from '../../src/ai/prompts/weeklySummary/v1';

/** The contract has already validated tool outputs; inspect only explicit reason codes. */
export function messagesReportPain(messages: readonly ChatMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === 'tool' &&
      message.results.some((result) => {
        if (typeof result.output !== 'object' || result.output === null || 'error' in result.output)
          return false;
        if (result.name === 'getExerciseHistory') {
          const output = result.output as ToolOutput<'getExerciseHistory'>;
          return output.sessions.some((s) => s.sets.some((set) => set.shortfall === 'pain'));
        }
        if (result.name === 'getRecentSessions') {
          const output = result.output as ToolOutput<'getRecentSessions'>;
          return output.sessions.some((s) =>
            s.exercises.some((e) => e.shortfalls.some((reason) => reason.reason === 'pain')),
          );
        }
        return false;
      }),
  );
}

/** A mandatory app sentence must not depend on the model remembering it. */
export function summaryWithReferral(summary: WeeklySummary, context: CoachContext): WeeklySummary {
  const reported = context.sessions.some((s) =>
    s.exercises.some((e) => e.sets.some((set) => set.shortfall === 'pain')),
  );
  if (!reported) return summary;
  return {
    ...summary,
    highlights: [
      ...summary.highlights.filter((h) => !h.includes(MEDICAL_REFERRAL)).slice(0, 3),
      MEDICAL_REFERRAL,
    ],
  };
}
