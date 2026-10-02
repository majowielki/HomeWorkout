import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { loadPlannerSource } from '@/db/repositories/plannerSource';
import { getCurrentBlock, saveBlockAdvance } from '@/db/repositories/trainingBlocks';
import { startPlannedWorkout } from '@/db/repositories/workouts';
import type { BlockEvent } from '@/domain/plan/reasons';
import type { SessionPlan } from '@/domain/plan/types';
import { planToday } from '@/domain/plan/today';
import type { MuscleGroup } from '@/domain/types';

import { SLOTS } from './slots';

export interface PlanToday {
  asOf: string;
  blockId: string;
  plan: SessionPlan;
  events: BlockEvent[];
  /** Direct working sets per muscle over the last 7 days. */
  volume: Record<MuscleGroup, number>;
}

type State = { status: 'loading' } | { status: 'error' } | ({ status: 'ready' } & PlanToday);

/**
 * Two screens can ask for today's plan at once; writing the block twice in
 * parallel could open block 1 twice. Every computation waits for the one
 * before it, so the second sees what the first stored.
 */
let queue: Promise<unknown> = Promise.resolve();

async function computeToday(): Promise<PlanToday> {
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
  const stored = await saveBlockAdvance(current, today.advance, source.asOf);
  return {
    asOf: source.asOf,
    blockId: stored.id,
    plan: today.plan,
    events: today.advance.events,
    volume: today.volume,
  };
}

/**
 * Today's plan from the rules engine, recomputed on every focus — the
 * daily log, a finished session or a changed exclusion all change it.
 * Also owns "start", which freezes the plan into the new session.
 */
export function usePlanToday() {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [starting, setStarting] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    const run = queue.then(computeToday);
    queue = run.catch(() => undefined);
    try {
      const today = await run;
      if (alive.current) setState({ status: 'ready', ...today });
    } catch {
      if (alive.current) setState({ status: 'error' });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      void load();
      return () => {
        alive.current = false;
      };
    }, [load]),
  );

  const start = useCallback(async () => {
    if (state.status !== 'ready' || starting) return;
    setStarting(true);
    try {
      const workoutId = await startPlannedWorkout(state.plan, state.asOf);
      router.push({ pathname: '/workout/active/[id]', params: { id: workoutId } });
    } finally {
      setStarting(false);
    }
  }, [router, starting, state]);

  return { state, starting, start, reload: load };
}
