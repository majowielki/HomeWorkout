import type { ExecuteEnvironment } from '@/ai/tools/execute';
import { loadCoachSource } from '@/db/repositories/coachSource';

/**
 * The phone's side of the tools: its own database, read fresh for every
 * call, so a session logged a minute ago is in the answer.
 */
export const toolEnvironment: ExecuteEnvironment = {
  load: (days) => loadCoachSource(new Date(), days),
  report: (tool, error) => console.warn(`chat tool ${tool} failed`, error),
};
