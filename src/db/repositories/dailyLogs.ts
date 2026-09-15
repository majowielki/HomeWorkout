import { eq } from 'drizzle-orm';

import type { MuscleGroup } from '@/domain/types';

import { db } from '../client';
import { dailyLogs } from '../schema';

export interface DailyLogInput {
  sleepHours?: number | null;
  energy?: number | null;
  stress?: number | null;
  soreness?: Partial<Record<MuscleGroup, number>> | null;
  steps?: number | null;
  note?: string | null;
}

export async function getDailyLog(date: string) {
  const [row] = await db.select().from(dailyLogs).where(eq(dailyLogs.date, date)).limit(1);
  return row ?? null;
}

/** The date is the primary key: one log per day, later saves overwrite. */
export async function upsertDailyLog(date: string, input: DailyLogInput): Promise<void> {
  const values = {
    sleepHours: input.sleepHours ?? null,
    energy: input.energy ?? null,
    stress: input.stress ?? null,
    soreness: input.soreness ?? null,
    steps: input.steps ?? null,
    note: input.note ?? null,
    updatedAt: new Date().toISOString(),
  };
  await db
    .insert(dailyLogs)
    .values({ date, ...values })
    .onConflictDoUpdate({ target: dailyLogs.date, set: values });
}
