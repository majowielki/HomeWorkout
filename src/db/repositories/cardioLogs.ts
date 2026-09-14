import { randomUUID } from 'expo-crypto';

import { and, eq } from 'drizzle-orm';

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
