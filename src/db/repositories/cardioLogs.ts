import { randomUUID } from 'expo-crypto';

import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { db } from '../client';
import { cardioLogs } from '../schema';

export interface LogCardioInput {
  workoutId: string | null;
  trainingDate: string;
  purpose: 'warmup' | 'cardio';
  minutes: number;
  resistanceLevel?: number | null;
  avgCadence?: number | null;
  avgHr?: number | null;
  rpe?: number | null;
}

export type CardioLogRow = typeof cardioLogs.$inferSelect;

export async function logCardio(input: LogCardioInput): Promise<string> {
  const id = randomUUID();
  await db.insert(cardioLogs).values({
    id,
    workoutId: input.workoutId,
    trainingDate: input.trainingDate,
    purpose: input.purpose,
    minutes: input.minutes,
    resistanceLevel: input.resistanceLevel ?? null,
    avgCadence: input.avgCadence ?? null,
    avgHr: input.avgHr ?? null,
    rpe: input.rpe ?? null,
    loggedAt: new Date().toISOString(),
  });
  return id;
}

export async function hasWarmupLog(workoutId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: cardioLogs.id })
    .from(cardioLogs)
    .where(and(eq(cardioLogs.workoutId, workoutId), eq(cardioLogs.purpose, 'warmup')))
    .limit(1);
  return row !== undefined;
}

/** Bike work done as part of one session (warm-up or a ride after), in order. */
export async function getCardioForWorkout(workoutId: string): Promise<CardioLogRow[]> {
  return db
    .select()
    .from(cardioLogs)
    .where(eq(cardioLogs.workoutId, workoutId))
    .orderBy(asc(cardioLogs.loggedAt));
}

/** Rides logged on their own, newest first — they have no session row to hang off in history. */
export async function listStandaloneRides(): Promise<CardioLogRow[]> {
  return db
    .select()
    .from(cardioLogs)
    .where(isNull(cardioLogs.workoutId))
    .orderBy(desc(cardioLogs.loggedAt));
}

export async function deleteCardioLog(id: string): Promise<void> {
  await db.delete(cardioLogs).where(eq(cardioLogs.id, id));
}
