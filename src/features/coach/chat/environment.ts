import type { ExecuteEnvironment } from '@/ai/tools/execute';
import { loadCoachSource } from '@/db/repositories/coachSource';
import { loadSimulationBase } from '@/db/repositories/weekPlan';
import { createPhonePlanTools } from '@/app-services/queries/planTools';
import { createSimulationHook } from '@/ai/tools/simulationEnvironment';

/**
 * The phone's side of the tools: its own database, read fresh for every
 * call, so a session logged a minute ago is in the answer.
 *
 * A day's plan is the one frozen when that day's session started; today,
 * before a session, it is the plan the "Dziś" screen shows, computed
 * without storing anything — the chat only reads.
 */
export const toolEnvironment: ExecuteEnvironment = {
  load: (days) => loadCoachSource(new Date(), days),
  ...createPhonePlanTools(),
  simulate: createSimulationHook(() => loadSimulationBase()),
  report: (tool, error) => console.warn(`chat tool ${tool} failed`, error),
};
