import type { DatedValue } from '@/domain/metrics/series';
import type { DumbbellMode, KneeProfile, MuscleGroup } from '@/domain/types';

/*
 * Plain rows, in domain terms, that `buildCoachContext` turns into a
 * `CoachContext`. They are what the repository hands over; none of them is
 * a Drizzle type, so the builder runs in a test with no database.
 */

export interface SourceWorkout {
  id: string;
  /** Training date, 'YYYY-MM-DD' (day-boundary aware). */
  trainingDate: string;
  startedAt: string;
  finishedAt: string | null;
  templateName: string;
  sessionRpe: number | null;
  notes: string | null;
}

export interface SourceSet {
  id: string;
  workoutId: string;
  exerciseId: string;
  exerciseOrder: number;
  setIndex: number;
  isWarmup: boolean;
  reps: number | null;
  timeSec: number | null;
  rir: number | null;
  weightKg: number | null;
  dumbbellMode: DumbbellMode | null;
  bandId: string | null;
  anchorPosition: number | null;
  loggedAt: string;
}

export interface SourceExercise {
  id: string;
  name: string;
  primaryMuscles: readonly MuscleGroup[];
  secondaryMuscles: readonly MuscleGroup[];
}

export interface SourceDailyLog {
  date: string;
  sleepHours: number | null;
  energy: number | null;
  stress: number | null;
  soreness: Partial<Record<MuscleGroup, number>> | null;
  note: string | null;
}

export interface CoachSource {
  /** The training date the context is about. */
  asOf: string;
  knee: KneeProfile | null;
  exercises: readonly SourceExercise[];
  /** Every completed session ever — the count and the last date come from here. */
  completedWorkouts: readonly SourceWorkout[];
  /** Sets of the completed sessions that fall in the window. */
  sets: readonly SourceSet[];
  /** Manual weigh-ins in the window. */
  weights: readonly DatedValue[];
  waists: readonly DatedValue[];
  dailyLogs: readonly SourceDailyLog[];
}
