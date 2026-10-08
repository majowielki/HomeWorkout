import { saveBlockAdvance } from '@/db/repositories/trainingBlocks';
import {
  getUnseenChanges,
  markDays,
  type PlanBanner,
  refreshForecasts,
  saveWeek,
} from '@/db/repositories/weekPlan';
import { directVolume } from '@/domain/plan/dayPlanner';
import { type MuscleRecovery, recoveryOutlook } from '@/domain/plan/dayState';
import { type BikePrescription, bikePrescription } from '@/domain/progression/bike';
import { layoffState } from '@/domain/progression/layoff';
import type { BlockEvent } from '@/domain/plan/reasons';
import type { SessionPlan } from '@/domain/plan/types';
import { type StoredDay, type SyncInput, syncWeek } from '@/domain/plan/weekSync';
import type { MuscleGroup } from '@/domain/types';

import { SLOTS } from './slots';
import { loadPlanningSnapshot } from './planningSnapshot';

export type { PlanBanner } from '@/db/repositories/weekPlan';

export interface PlanToday {
  asOf: string;
  /** The stored block's row id; null when `persist` was off and no block exists yet. */
  blockId: string | null;
  /** Today's plan; null on a rest day and once today is trained. */
  plan: SessionPlan | null;
  events: BlockEvent[];
  /** Direct working sets per muscle over the last 7 days. */
  volume: Record<MuscleGroup, number>;
  /** Today's ride — its own task, whatever the day holds (SPEC §7). */
  bike: BikePrescription;
  /** A session was completed today: the day is closed. */
  done: boolean;
  /** Today rests — by the weekly pattern or a request. */
  rest: boolean;
  /** Muscles still resting after the work up to today, soonest first. */
  recovery: MuscleRecovery[];
  /** The next day's plan once today is trained; null when it rests. */
  tomorrow: SessionPlan | null;
  /** The days ahead as planned, from today (or tomorrow once today is trained). */
  week: StoredDay[];
  /** What the last automatic or requested replanning changed, until closed. */
  banner: PlanBanner | null;
}

/**
 * Two callers can ask for today's plan at once; writing the week twice in
 * parallel could store a half of each. Every computation waits for the
 * one before it, so the second sees what the first stored.
 */
let queue: Promise<unknown> = Promise.resolve();

/** Coach acceptance shares the queue with normal sync, so neither can overwrite the other. */
export function withPlanningLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Today's plan from the stored week (SPEC §11.5). Each call brings the
 * week up to date — marks past days, extends the horizon, keeps every day
 * that still holds and plans again the ones that do not — and, with
 * `persist`, stores it and the block moved to today. The chat only reads
 * and passes `persist: false`: the answer is the same, nothing is written.
 *
 * `request` plans from scratch: "Przelicz tydzień", a new request to the
 * planner, the coach's accepted proposal.
 */
export function computeToday({
  persist,
  request,
}: {
  persist: boolean;
  request?: SyncInput['request'];
}): Promise<PlanToday> {
  return withPlanningLock(async (): Promise<PlanToday> => {
    const { source, current, advance, input } = await loadPlanningSnapshot();
    const { asOf, catalog } = source;
    const { trainedDates } = input;
    const blockId = persist
      ? (await saveBlockAdvance(current, advance, asOf)).id
      : (current?.id ?? null);

    const sync = syncWeek({ ...input, request });

    if (persist) {
      if (sync.trigger !== null) {
        await saveWeek({
          statusUpdates: sync.statusUpdates,
          rows: sync.rows,
          trigger: sync.trigger,
          fromDate: sync.from,
          changes: sync.changes,
        });
      } else {
        await markDays(sync.statusUpdates);
        await refreshForecasts(sync.rows);
      }
    }

    const done = trainedDates.has(asOf);
    const first = sync.week.days[0];
    const today = done ? undefined : first;
    return {
      asOf,
      blockId,
      plan: today?.forecast ?? null,
      events: advance.events,
      volume: directVolume(source.sessions, catalog, asOf),
      bike: bikePrescription(
        source.rides,
        layoffState(
          source.sessions.map((s) => s.date),
          asOf,
        ),
      ),
      done,
      rest: today?.rest ?? false,
      recovery: recoveryOutlook(source.sessions, catalog, SLOTS, asOf),
      tomorrow: done ? (first?.forecast ?? null) : null,
      week: sync.rows,
      banner: persist ? await getUnseenChanges() : null,
    };
  });
}
