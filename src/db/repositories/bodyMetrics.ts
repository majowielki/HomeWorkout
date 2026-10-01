import { randomUUID } from 'expo-crypto';

import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';

import type { DatedValue } from '@/domain/metrics/series';

import { db } from '../client';
import { bodyMetrics } from '../schema';

type Source = 'manual' | 'scale' | 'navy';

/**
 * One manual weigh-in per calendar day: a second entry on the same day
 * replaces the first. Morning weight is the only one that means anything,
 * so there is no reason to keep intraday duplicates.
 */
export async function upsertWeight(date: string, weightKg: number): Promise<void> {
  const [existing] = await db
    .select({ id: bodyMetrics.id })
    .from(bodyMetrics)
    .where(and(eq(bodyMetrics.date, date), eq(bodyMetrics.source, 'manual')))
    .limit(1);

  const loggedAt = new Date().toISOString();
  if (existing) {
    await db.update(bodyMetrics).set({ weightKg, loggedAt }).where(eq(bodyMetrics.id, existing.id));
  } else {
    await db.insert(bodyMetrics).values({
      id: randomUUID(),
      date,
      weightKg,
      source: 'manual',
      loggedAt,
    });
  }
}

/** Manual weigh-ins from `sinceDate` onward, ascending — the series charts and averages use. */
export async function getWeightSeries(sinceDate: string): Promise<DatedValue[]> {
  const rows = await db
    .select({ date: bodyMetrics.date, value: bodyMetrics.weightKg })
    .from(bodyMetrics)
    .where(and(eq(bodyMetrics.source, 'manual'), gte(bodyMetrics.date, sinceDate)))
    .orderBy(asc(bodyMetrics.date));
  return rows;
}

export async function getLatestWeight() {
  const [row] = await db
    .select()
    .from(bodyMetrics)
    .where(eq(bodyMetrics.source, 'manual'))
    .orderBy(desc(bodyMetrics.date))
    .limit(1);
  return row ?? null;
}

export async function getWeightOn(date: string) {
  const [row] = await db
    .select()
    .from(bodyMetrics)
    .where(and(eq(bodyMetrics.date, date), eq(bodyMetrics.source, 'manual')))
    .limit(1);
  return row ?? null;
}

/** Latest manual weigh-in on or before `date` — for attaching a weight to a Navy estimate. */
export async function getWeightOnOrBefore(date: string) {
  const [row] = await db
    .select()
    .from(bodyMetrics)
    .where(and(eq(bodyMetrics.source, 'manual'), lte(bodyMetrics.date, date)))
    .orderBy(desc(bodyMetrics.date))
    .limit(1);
  return row ?? null;
}

/** Persists a derived body-fat estimate; replaces an earlier estimate for the same day. */
export async function upsertEstimate(
  date: string,
  source: Exclude<Source, 'manual'>,
  weightKg: number,
  bodyFatPct: number,
): Promise<void> {
  const [existing] = await db
    .select({ id: bodyMetrics.id })
    .from(bodyMetrics)
    .where(and(eq(bodyMetrics.date, date), eq(bodyMetrics.source, source)))
    .limit(1);

  const loggedAt = new Date().toISOString();
  if (existing) {
    await db
      .update(bodyMetrics)
      .set({ weightKg, bodyFatPct, loggedAt })
      .where(eq(bodyMetrics.id, existing.id));
  } else {
    await db
      .insert(bodyMetrics)
      .values({ id: randomUUID(), date, weightKg, bodyFatPct, source, loggedAt });
  }
}

export async function getLatestEstimate(source: Exclude<Source, 'manual'>) {
  const [row] = await db
    .select()
    .from(bodyMetrics)
    .where(eq(bodyMetrics.source, source))
    .orderBy(desc(bodyMetrics.date))
    .limit(1);
  return row ?? null;
}
