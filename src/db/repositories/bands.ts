import { eq, sql } from 'drizzle-orm';

import type { BandCalibration } from '@/domain/types';

import { db } from '../client';
import { bands } from '../schema';

export type BandRow = typeof bands.$inferSelect;

export async function listBands(): Promise<BandRow[]> {
  return db.select().from(bands).orderBy(bands.nominalMinKg);
}

export async function getBand(id: string): Promise<BandRow | null> {
  const [row] = await db.select().from(bands).where(eq(bands.id, id)).limit(1);
  return row ?? null;
}

/**
 * Stores a (re)calibration and restarts the wear counter — the cycles
 * that softened the band are now baked into the new curve.
 */
export async function saveCalibration(
  id: string,
  calibration: BandCalibration,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(bands)
    .set({ calibration, calibratedAt: now.toISOString(), cycleCount: 0 })
    .where(eq(bands.id, id));
}

/** Adds one set's reps to the band's wear counter (SPEC §5.6). */
export async function addBandCycles(id: string, reps: number): Promise<void> {
  if (reps <= 0) return;
  await db
    .update(bands)
    .set({ cycleCount: sql`${bands.cycleCount} + ${reps}` })
    .where(eq(bands.id, id));
}
