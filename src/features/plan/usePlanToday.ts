import { useFocusEffect, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { markChangesSeen, type WeekSyncRequest } from '@/db/repositories/weekPlan';
import { acceptDay } from '@/db/repositories/planning';
import { pl } from '@/strings/pl';

import { readToday, type PlanToday } from './today';

export type { PlanToday } from './today';

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
  const startingRef = useRef(false);

  const load = useCallback(async (request?: WeekSyncRequest['request']) => {
    try {
      const today = readToday(request);
      if (alive.current) setState({ status: 'ready', ...today });
    } catch {
      if (alive.current) setState({ status: 'error' });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      startingRef.current = false;
      void load(undefined);
      return () => {
        alive.current = false;
      };
    }, [load]),
  );

  const start = useCallback(async () => {
    if (
      state.status !== 'ready' ||
      !state.plan ||
      state.preview.planHash === null ||
      startingRef.current
    )
      return;
    startingRef.current = true;
    setStarting(true);
    let accepted = false;
    try {
      const result = acceptDay({
        commandId: randomUUID(),
        request: state.preview.request,
        expectedPlanHash: state.preview.planHash,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (result.kind !== 'committed') {
        await load();
        Alert.alert(pl.plan.startError);
        return;
      }
      accepted = true;
      router.push({ pathname: '/workout/active/[id]', params: { id: result.result.sessionId } });
    } catch (error) {
      console.warn('could not start the planned session', error);
      Alert.alert(pl.plan.startError);
    } finally {
      startingRef.current = accepted;
      setStarting(false);
    }
  }, [router, load, state]);

  /** "Przelicz tydzień": the week planned again from scratch. */
  const recalculate = useCallback(() => load({ trigger: 'manual' }), [load]);

  /** Closes the banner of the last replanning. */
  const dismissBanner = useCallback(
    async (id: string) => {
      await markChangesSeen(id);
      await load(undefined);
    },
    [load],
  );

  return {
    state,
    starting,
    start,
    /** Recompute now; with a request, plan again from it (a changed day, a new restriction). */
    reload: (request?: WeekSyncRequest['request']) => load(request),
    recalculate,
    dismissBanner,
  };
}
