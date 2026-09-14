import { randomUUID } from 'expo-crypto';

import { and, desc, eq } from 'drizzle-orm';

import type { AnchorPosition, DumbbellMode } from '@/domain/types';

import { db } from '../client';
import { setLogs } from '../schema';

export interface LogSetInput {
  workoutId: string;
  exerciseId: string;
  exerciseOrder: number;
  setIndex: number;
  isWarmup?: boolean;
  reps?: number | null;
  timeSec?: number | null;
  rir?: number | null;
  weightKg?: number | null;
  dumbbellMode?: DumbbellMode | null;
  bandId?: string | null;
  anchorPosition?: AnchorPosition | null;
  estimatedLoadKg?: number | null;
}

export async function logSet(input: LogSetInput): Promise<string> {
  const id = randomUUID();
  await db.insert(setLogs).values({
    id,
    workoutId: input.workoutId,
    exerciseId: input.exerciseId,
    exerciseOrder: input.exerciseOrder,
    setIndex: input.setIndex,
    isWarmup: input.isWarmup ?? false,
    reps: input.reps ?? null,
    timeSec: input.timeSec ?? null,
    rir: input.rir ?? null,
    weightKg: input.weightKg ?? null,
    dumbbellMode: input.dumbbellMode ?? null,
    bandId: input.bandId ?? null,
    anchorPosition: input.anchorPosition ?? null,
    estimatedLoadKg: input.estimatedLoadKg ?? null,
    loggedAt: new Date().toISOString(),
  });
  return id;
}

export async function getSetsForWorkout(workoutId: string) {
  return db.select().from(setLogs).where(eq(setLogs.workoutId, workoutId));
}

/**
 * Which (blockIndex, setNumber) pairs already have a log for this workout —
 * used by domain/session/steps.findResumeIndex to pick up where a killed
 * app left off, without trusting any in-memory state.
 */
export async function getLoggedStepKeys(workoutId: string): Promise<Set<string>> {
  const rows = await db
    .select({ exerciseOrder: setLogs.exerciseOrder, setIndex: setLogs.setIndex })
    .from(setLogs)
    .where(and(eq(setLogs.workoutId, workoutId), eq(setLogs.isWarmup, false)));
  return new Set(rows.map((r) => `${r.exerciseOrder}:${r.setIndex}`));
}

/** Most recent non-warmup log for this exercise, for prefilling the next session. */
export async function getLastSetForExercise(exerciseId: string) {
  const [row] = await db
    .select()
    .from(setLogs)
    .where(and(eq(setLogs.exerciseId, exerciseId), eq(setLogs.isWarmup, false)))
    .orderBy(desc(setLogs.loggedAt))
    .limit(1);
  return row ?? null;
}

export async function countWorkingSets(workoutId: string): Promise<number> {
  const rows = await getSetsForWorkout(workoutId);
  return rows.filter((r) => !r.isWarmup).length;
}
