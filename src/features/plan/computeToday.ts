import { loadPlannerSource } from '@/db/repositories/plannerSource';
import { getCurrentBlock, saveBlockAdvance } from '@/db/repositories/trainingBlocks';
import { type MuscleRecovery, recoveryOutlook } from '@/domain/plan/dayState';
import type { BlockEvent } from '@/domain/plan/reasons';
import type { SessionPlan } from '@/domain/plan/types';
import { planToday } from '@/domain/plan/today';
import { addDays } from '@/domain/time/trainingDate';
import type { MuscleGroup } from '@/domain/types';

import { SLOTS } from './slots';

export interface PlanToday {
  asOf: string;
  /** The stored block's row id; null when `persist` was off and no block exists yet. */
  blockId: string | null;
  plan: SessionPlan;
  events: BlockEvent[];
  /** Direct working sets per muscle over the last 7 days. */
  volume: Record<MuscleGroup, number>;
  /**
   * A session was completed today: the day is closed. `plan` is then only
   * what is left (light work, nothing the muscles need) — the screens show
   * the recovery and `tomorrow` instead of offering it as today's plan.
   */
  done: boolean;
  /** Muscles still resting after the work up to today, soonest first. */
  recovery: MuscleRecovery[];
  /** The plan for the next day, as it stands now; only once today is done. */
  tomorrow: SessionPlan | null;
}

/**
 * Two callers can ask for today's plan at once; writing the block twice in
 * parallel could open block 1 twice. Every computation waits for the one
 * before it, so the second sees what the first stored.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Today's plan from the rules engine. `persist` stores the block as moved
 * to today (the screens do); the chat only reads and passes `false` — the
 * plan is the same either way, because the engine is deterministic.
 *
 * Once today's session is completed the day is closed, and the next day's
 * plan is computed from the same logs — today's sets included. Its block
 * is moved to tomorrow in memory only; tomorrow stores it for real.
 */
export function computeToday({ persist }: { persist: boolean }): Promise<PlanToday> {
  const run = queue.then(async (): Promise<PlanToday> => {
    const source = await loadPlannerSource();
    const current = await getCurrentBlock();
    const base = {
      catalog: source.catalog,
      slots: SLOTS,
      eligibility: { profile: source.profile, excludedIds: new Set(source.excludedIds) },
      sessions: source.sessions,
      lastSessionDate: source.lastSessionDate,
      rides: source.rides,
      daily: source.daily,
      calibrations: source.calibrations,
    };
    const today = planToday({ ...base, asOf: source.asOf, block: current?.state ?? null });
    const blockId = persist
      ? (await saveBlockAdvance(current, today.advance, source.asOf)).id
      : (current?.id ?? null);
    const done = source.lastSessionDate === source.asOf;
    const tomorrow = done
      ? planToday({ ...base, asOf: addDays(source.asOf, 1), block: today.advance.block }).plan
      : null;
    return {
      asOf: source.asOf,
      blockId,
      plan: today.plan,
      events: today.advance.events,
      volume: today.volume,
      done,
      recovery: recoveryOutlook(source.sessions, source.catalog, SLOTS, source.asOf),
      tomorrow,
    };
  });
  queue = run.catch(() => undefined);
  return run;
}
