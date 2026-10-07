import type { ExecuteEnvironment } from '@/ai/tools/execute';
import { loadCoachSource } from '@/db/repositories/coachSource';
import { getDayBoundaryHour } from '@/db/repositories/profile';
import { findPlannedWorkoutOn } from '@/db/repositories/workouts';
import { addDays, trainingDate } from '@/domain/time/trainingDate';
import { computeToday } from '@/features/plan/computeToday';
import { SLOT_NAMES } from '@/features/plan/slots';

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
  async plan(daysAgo) {
    const asOf = trainingDate(new Date(), await getDayBoundaryHour());
    const row = await findPlannedWorkoutOn(addDays(asOf, -daysAgo));
    if (row?.plan) return { plan: row.plan, source: 'session', slotNames: SLOT_NAMES };
    if (daysAgo !== 0) return null;
    const today = await computeToday({ persist: false });
    return today.plan ? { plan: today.plan, source: 'today', slotNames: SLOT_NAMES } : null;
  },
  report: (tool, error) => console.warn(`chat tool ${tool} failed`, error),
};
