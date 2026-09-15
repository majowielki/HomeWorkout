import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { getDayBoundaryHour } from '@/db/repositories/profile';
import { listActiveTemplates } from '@/db/repositories/templates';
import {
  abandonWorkout,
  findInProgressWorkout,
  lastCompletedWorkout,
  startWorkout,
} from '@/db/repositories/workouts';
import { nextTemplateId } from '@/domain/session/schedule';
import { daysBetween, trainingDate } from '@/domain/time/trainingDate';

type TemplateRow = Awaited<ReturnType<typeof listActiveTemplates>>[number];
type InProgress = Awaited<ReturnType<typeof findInProgressWorkout>>;

export interface SessionOverview {
  templates: TemplateRow[];
  inProgress: InProgress;
  suggested: TemplateRow | null;
  lastTemplateName: string | null;
  lastSessionDaysAgo: number | null;
  todayTrainingDate: string;
}

/**
 * Everything the "Dziś" and "Trening" screens need to describe where the
 * user is in the rolling A/B cycle, refreshed on every focus. Also owns
 * the start/resume/discard actions so both screens behave identically.
 */
export function useSessionOverview() {
  const router = useRouter();
  const [data, setData] = useState<SessionOverview | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const [templates, inProgress, lastWorkout, boundaryHour] = await Promise.all([
      listActiveTemplates(),
      findInProgressWorkout(),
      lastCompletedWorkout(),
      getDayBoundaryHour(),
    ]);
    const today = trainingDate(new Date(), boundaryHour);
    const suggestedId = nextTemplateId(templates, lastWorkout?.templateId ?? null);
    setData({
      templates,
      inProgress,
      suggested: templates.find((t) => t.id === suggestedId) ?? null,
      lastTemplateName: templates.find((t) => t.id === lastWorkout?.templateId)?.name ?? null,
      lastSessionDaysAgo: lastWorkout ? daysBetween(lastWorkout.trainingDate, today) : null,
      todayTrainingDate: today,
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const start = useCallback(
    async (templateId: string) => {
      if (starting) return;
      setStarting(true);
      try {
        const boundaryHour = await getDayBoundaryHour();
        const workoutId = await startWorkout(templateId, trainingDate(new Date(), boundaryHour));
        router.push({ pathname: '/workout/active/[id]', params: { id: workoutId } });
      } finally {
        setStarting(false);
      }
    },
    [router, starting],
  );

  const resume = useCallback(
    (workoutId: string) => {
      router.push({ pathname: '/workout/active/[id]', params: { id: workoutId } });
    },
    [router],
  );

  const discard = useCallback(
    async (workoutId: string) => {
      await abandonWorkout(workoutId);
      await load();
    },
    [load],
  );

  return { data, starting, start, resume, discard, reload: load };
}
