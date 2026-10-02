import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { startPlannedWorkout } from '@/db/repositories/workouts';

import { computeToday, type PlanToday } from './computeToday';

export type { PlanToday } from './computeToday';

type State = { status: 'loading' } | { status: 'error' } | ({ status: 'ready' } & PlanToday);

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
    try {
      const today = await computeToday({ persist: true });
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
