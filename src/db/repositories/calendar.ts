import { and, count, eq, gte, inArray, lte } from 'drizzle-orm';

import { db } from '../client';
import { cardioLogs, dailyLogs, setLogs, workoutTemplates, workouts } from '../schema';
import { getComposedDays, getPlannedDays } from './weekPlan';

/** Bounded reads for the visible grid; never loads the entire training history. */
export async function getCalendarRange(from: string, until: string) {
  const [sessions, rides, diary, days, composed] = await Promise.all([
    db
      .select({ workout: workouts, templateName: workoutTemplates.name })
      .from(workouts)
      .leftJoin(workoutTemplates, eq(workouts.templateId, workoutTemplates.id))
      .where(and(gte(workouts.trainingDate, from), lte(workouts.trainingDate, until)))
      .orderBy(workouts.startedAt),
    db
      .select()
      .from(cardioLogs)
      .where(and(gte(cardioLogs.trainingDate, from), lte(cardioLogs.trainingDate, until)))
      .orderBy(cardioLogs.loggedAt),
    db
      .select()
      .from(dailyLogs)
      .where(and(gte(dailyLogs.date, from), lte(dailyLogs.date, until))),
    getPlannedDays(from, until),
    getComposedDays(from, until),
  ]);
  const ids = sessions.map((s) => s.workout.id);
  const counts =
    ids.length === 0
      ? []
      : await db
          .select({ id: setLogs.workoutId, n: count() })
          .from(setLogs)
          .where(and(inArray(setLogs.workoutId, ids), eq(setLogs.isWarmup, false)))
          .groupBy(setLogs.workoutId);
  const byId = new Map(counts.map((c) => [c.id, c.n]));
  return {
    sessions: sessions.map((s) => ({ ...s, sets: byId.get(s.workout.id) ?? 0 })),
    rides,
    diary,
    days,
    composed,
  };
}

export type CalendarData = Awaited<ReturnType<typeof getCalendarRange>>;
