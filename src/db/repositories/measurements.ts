import { randomUUID } from 'expo-crypto';

import { asc, desc, eq, gte, isNotNull, and } from 'drizzle-orm';

import type { DatedValue } from '@/domain/metrics/series';

import { db } from '../client';
import { measurements } from '../schema';

export interface MeasurementInput {
  waistCm?: number | null;
  hipsCm?: number | null;
  chestCm?: number | null;
  armCm?: number | null;
  thighCm?: number | null;
  neckCm?: number | null;
}

/** One set of circumferences per day; re-saving the same day overwrites. */
export async function upsertMeasurement(date: string, input: MeasurementInput): Promise<void> {
  const [existing] = await db
    .select({ id: measurements.id })
    .from(measurements)
    .where(eq(measurements.date, date))
    .limit(1);

  const values = {
    waistCm: input.waistCm ?? null,
    hipsCm: input.hipsCm ?? null,
    chestCm: input.chestCm ?? null,
    armCm: input.armCm ?? null,
    thighCm: input.thighCm ?? null,
    neckCm: input.neckCm ?? null,
    loggedAt: new Date().toISOString(),
  };

  if (existing) {
    await db.update(measurements).set(values).where(eq(measurements.id, existing.id));
  } else {
    await db.insert(measurements).values({ id: randomUUID(), date, ...values });
  }
}

export async function getLatestMeasurement() {
  const [row] = await db.select().from(measurements).orderBy(desc(measurements.date)).limit(1);
  return row ?? null;
}

export async function getWaistSeries(sinceDate: string): Promise<DatedValue[]> {
  const rows = await db
    .select({ date: measurements.date, value: measurements.waistCm })
    .from(measurements)
    .where(and(gte(measurements.date, sinceDate), isNotNull(measurements.waistCm)))
    .orderBy(asc(measurements.date));
  return rows.filter((r): r is { date: string; value: number } => r.value !== null);
}
