import { and, asc, desc, eq, gte, isNull } from 'drizzle-orm';

import type { DailyReadiness } from '@/domain/plan/types';
import type { Ride } from '@/domain/progression/bike';
import type { HistorySession } from '@/domain/progression/history';
import { loadOfSet } from '@/domain/progression/load';
import { addDays, trainingDate } from '@/domain/time/trainingDate';
import type { BandCalibrationMap, Exercise, MedicalProfile } from '@/domain/types';

import { db } from '../client';
import { bands, cardioLogs, dailyLogs, exercises, setLogs, workouts } from '../schema';
import { getDayBoundaryHour, getExcludedExerciseIds, getMedicalProfile } from './profile';

/** How far back the engine reads sessions: long enough for every layoff tier and RE_EXPOSURE. */
const HISTORY_DAYS = 120;
/** The morning logs the engine reads: today's, and runs of up to four days (SPEC §6.1). */
const DAILY_DAYS = 14;

/**
 * Everything the rules engine reads, as plain domain data — nothing here
 * is a Drizzle type, so `planToday` runs in a test with no database.
 */
export interface PlannerSource {
  asOf: string;
  catalog: Record<string, Exercise>;
  profile: MedicalProfile;
  excludedIds: string[];
  /** Completed sessions (one per workout) of the last HISTORY_DAYS, oldest first; sets in the order logged. */
  sessions: HistorySession[];
  /** The latest completed session ever, which may be older than `sessions` reach. */
  lastSessionDate: string | null;
  /** Bike rides, oldest first: warm-ups and standalone rides alike. */
  rides: Ride[];
  daily: DailyReadiness[];
  calibrations: BandCalibrationMap;
}

export async function loadPlannerSource(now: Date = new Date()): Promise<PlannerSource> {
  const asOf = trainingDate(now, await getDayBoundaryHour());
  const historyStart = addDays(asOf, -(HISTORY_DAYS - 1));
  const dailyStart = addDays(asOf, -(DAILY_DAYS - 1));

  const [profile, excludedIds, exerciseRows, setRows, lastRow, rideRows, dailyRows, bandRows] =
    await Promise.all([
      getMedicalProfile(),
      getExcludedExerciseIds(),
      db.select({ data: exercises.data }).from(exercises),
      db
        .select({ set: setLogs, date: workouts.trainingDate })
        .from(setLogs)
        .innerJoin(workouts, eq(setLogs.workoutId, workouts.id))
        .where(
          and(
            eq(workouts.status, 'completed'),
            gte(workouts.trainingDate, historyStart),
            isNull(setLogs.deletedAt),
          ),
        )
        .orderBy(
          asc(workouts.trainingDate),
          asc(workouts.startedAt),
          asc(workouts.id),
          asc(setLogs.loggedAt),
        ),
      db
        .select({ date: workouts.trainingDate })
        .from(workouts)
        .where(eq(workouts.status, 'completed'))
        .orderBy(desc(workouts.trainingDate))
        .limit(1),
      db
        .select()
        .from(cardioLogs)
        .where(gte(cardioLogs.trainingDate, historyStart))
        .orderBy(asc(cardioLogs.trainingDate), asc(cardioLogs.loggedAt)),
      db.select().from(dailyLogs).where(gte(dailyLogs.date, dailyStart)),
      db.select({ id: bands.id, calibration: bands.calibration }).from(bands),
    ]);

  // One HistorySession per workout, not per day: a main and an extra session on
  // the same date stay apart, and the engine decides how each rule reads them.
  const sessions: HistorySession[] = [];
  let workoutId: string | null = null;
  for (const { set, date } of setRows) {
    let session = sessions[sessions.length - 1];
    if (!session || set.workoutId !== workoutId) {
      session = { date, sets: [] };
      sessions.push(session);
      workoutId = set.workoutId;
    }
    session.sets.push({
      exerciseId: set.exerciseId,
      isWarmup: set.isWarmup,
      reps: set.reps,
      timeSec: set.timeSec,
      rir: set.rir,
      load: loadOfSet(set),
      side: set.side,
    });
  }

  return {
    asOf,
    catalog: Object.fromEntries(exerciseRows.map((r) => [r.data.id, r.data])),
    profile,
    excludedIds,
    sessions,
    lastSessionDate: lastRow[0]?.date ?? null,
    rides: rideRows.map((r) => ({
      date: r.trainingDate,
      minutes: r.minutes,
      resistance: r.resistanceLevel,
      rpe: r.rpe,
    })),
    daily: dailyRows.map((r) => ({
      date: r.date,
      sleepHours: r.sleepHours,
      energy: r.energy,
      soreness: r.soreness,
    })),
    calibrations: Object.fromEntries(bandRows.map((b) => [b.id, b.calibration])),
  };
}
