import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { listActiveTemplates } from '@/db/repositories/templates';
import { findInProgressWorkout } from '@/db/repositories/workouts';

type TemplateRow = Awaited<ReturnType<typeof listActiveTemplates>>[number];
type InProgress = Awaited<ReturnType<typeof findInProgressWorkout>>;

export interface SessionOverview {
  inProgress: InProgress;
  /** For the name of a session in progress that was started from an old FBW template. */
  templates: TemplateRow[];
}

/**
 * The session in progress, if any, refreshed on every focus — for "Dziś" and
 * the calendar, which both offer to resume it. New sessions start from the
 * engine's plan (usePlanToday) or the extra-session screen.
 */
export function useSessionOverview() {
  const router = useRouter();
  const [data, setData] = useState<SessionOverview | null>(null);

  const load = useCallback(async () => {
    const [templates, inProgress] = await Promise.all([
      listActiveTemplates(),
      findInProgressWorkout(),
    ]);
    setData({ templates, inProgress });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const resume = useCallback(
    (workoutId: string) => {
      router.push({ pathname: '/workout/active/[id]', params: { id: workoutId } });
    },
    [router],
  );

  return { data, resume, reload: load };
}
