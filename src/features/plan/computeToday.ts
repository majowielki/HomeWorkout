import { loadPlannerSource } from '@/db/repositories/plannerSource';
import { getCurrentBlock, saveBlockAdvance } from '@/db/repositories/trainingBlocks';
import type { BlockEvent } from '@/domain/plan/reasons';
import type { SessionPlan } from '@/domain/plan/types';
import { planToday } from '@/domain/plan/today';
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
 */
export function computeToday({ persist }: { persist: boolean }): Promise<PlanToday> {
  const run = queue.then(async (): Promise<PlanToday> => {
    const source = await loadPlannerSource();
    const current = await getCurrentBlock();
    const today = planToday({
      asOf: source.asOf,
      catalog: source.catalog,
      slots: SLOTS,
      eligibility: { profile: source.profile, excludedIds: new Set(source.excludedIds) },
      block: current?.state ?? null,
      sessions: source.sessions,
      lastSessionDate: source.lastSessionDate,
      rides: source.rides,
      daily: source.daily,
      calibrations: source.calibrations,
    });
    const blockId = persist
      ? (await saveBlockAdvance(current, today.advance, source.asOf)).id
      : (current?.id ?? null);
    return {
      asOf: source.asOf,
      blockId,
      plan: today.plan,
      events: today.advance.events,
      volume: today.volume,
    };
  });
  queue = run.catch(() => undefined);
  return run;
}
