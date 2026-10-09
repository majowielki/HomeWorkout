import { and, asc, eq, gte } from 'drizzle-orm';

import type { CoachSource } from '@/ai/context/source';
import { COACH_CONFIG } from '@/domain/config/training';
import { addDays, trainingDate } from '@/domain/time/trainingDate';

import { db } from '../client';
import { dailyLogs, exercises, setLogs, workouts, workoutTemplates } from '../schema';
import { getWeightSeries } from './bodyMetrics';
import { getWaistSeries } from './measurements';
import { getDayBoundaryHour, getMedicalProfile } from './profile';

/**
 * Everything `buildCoachContext` needs, read in one pass and handed over
 * as plain rows. Nothing here is a Drizzle type: the builder runs in a
 * test with no database (AI-INTEGRACJA §4.1).
 *
 * `windowDays` limits the sets, measurements and daily logs; the chat tools
 * ask for longer windows than the weekly brief does.
 *
 * Only completed sessions count. An abandoned or in-progress one is not a
 * result, and the summary is about results.
 */
export async function loadCoachSource(
  now: Date = new Date(),
  windowDays: number = COACH_CONFIG.windowDays,
): Promise<CoachSource> {
  const asOf = trainingDate(now, await getDayBoundaryHour());
  const windowStart = addDays(asOf, -(windowDays - 1));

  const [medical, exerciseRows, workoutRows, setRows, weights, waists, logRows] = await Promise.all(
    [
      getMedicalProfile(),
      db.select({ id: exercises.id, name: exercises.name, data: exercises.data }).from(exercises),
      db
        .select({ workout: workouts, templateName: workoutTemplates.name })
        .from(workouts)
        .leftJoin(workoutTemplates, eq(workouts.templateId, workoutTemplates.id))
        .where(eq(workouts.status, 'completed'))
        .orderBy(asc(workouts.trainingDate)),
      db
        .select({ set: setLogs })
        .from(setLogs)
        .innerJoin(workouts, eq(setLogs.workoutId, workouts.id))
        .where(and(eq(workouts.status, 'completed'), gte(workouts.trainingDate, windowStart))),
      getWeightSeries(windowStart),
      getWaistSeries(windowStart),
      db.select().from(dailyLogs).where(gte(dailyLogs.date, windowStart)),
    ],
  );

  return {
    asOf,
    knee: medical.knee,
    exercises: exerciseRows.map((row) => ({
      id: row.id,
      name: row.name,
      movementPattern: row.data.movementPattern,
      primaryMuscles: row.data.primaryMuscles,
      secondaryMuscles: row.data.secondaryMuscles,
    })),
    completedWorkouts: workoutRows.map(({ workout, templateName }) => ({
      id: workout.id,
      trainingDate: workout.trainingDate,
      startedAt: workout.startedAt,
      finishedAt: workout.finishedAt,
      // A session from the engine's plan has no template; it is still a session.
      templateName: templateName ?? (workout.plan ? 'plan' : 'custom'),
      sessionRpe: workout.sessionRpe,
      notes: workout.notes,
    })),
    sets: setRows.map(({ set }) => ({
      id: set.id,
      workoutId: set.workoutId,
      exerciseId: set.exerciseId,
      exerciseOrder: set.exerciseOrder,
      setIndex: set.setIndex,
      isWarmup: set.isWarmup,
      reps: set.reps,
      timeSec: set.timeSec,
      rir: set.rir,
      shortfall: set.shortfall,
      weightKg: set.weightKg,
      dumbbellMode: set.dumbbellMode,
      bandId: set.bandId,
      anchorPosition: set.anchorPosition,
      side: set.side,
      loggedAt: set.loggedAt,
    })),
    weights,
    waists,
    dailyLogs: logRows.map((log) => ({
      date: log.date,
      sleepHours: log.sleepHours,
      energy: log.energy,
      stress: log.stress,
      soreness: log.soreness,
      note: log.note,
    })),
  };
}
