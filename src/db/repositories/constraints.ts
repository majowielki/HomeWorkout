import { randomUUID } from 'expo-crypto';

import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

import { overrideDay, type PlanConstraint } from '@/domain/plan/constraints';

import { db } from '../client';
import { planConstraints } from '../schema';

type ConstraintRow = typeof planConstraints.$inferSelect;

function toConstraint(r: ConstraintRow): PlanConstraint {
  return {
    id: r.id,
    kind: r.kind,
    muscles: r.muscles,
    from: r.fromDate,
    until: r.untilDate,
    reason: r.reason,
    source: r.source,
    note: r.note,
    ...(r.items ? { items: r.items } : {}),
  };
}

/** A request as a new row, in force until taken back. */
export function constraintRow(c: Omit<PlanConstraint, 'id'>, createdAt: string) {
  return {
    id: randomUUID(),
    kind: c.kind,
    muscles: c.muscles,
    fromDate: c.from,
    untilDate: c.until,
    reason: c.reason,
    source: c.source,
    note: c.note,
    items: c.items ? [...c.items] : null,
    createdAt,
    revokedAt: null,
  };
}

/** Requests that still apply on or after `from`, not taken back. */
export async function getActiveConstraints(from: string): Promise<PlanConstraint[]> {
  const rows = await db
    .select()
    .from(planConstraints)
    .where(and(isNull(planConstraints.revokedAt), gte(planConstraints.untilDate, from)));
  return rows.map(toConstraint);
}

/** Days composed with the coach between two dates (compose_day requests not taken back). */
export async function getComposedDays(
  from: string,
  until: string,
): Promise<{ id: string; date: string }[]> {
  const rows = await db
    .select({ id: planConstraints.id, date: planConstraints.fromDate })
    .from(planConstraints)
    .where(
      and(
        eq(planConstraints.kind, 'compose_day'),
        isNull(planConstraints.revokedAt),
        gte(planConstraints.fromDate, from),
        lte(planConstraints.fromDate, until),
      ),
    );
  return rows;
}

export async function addConstraint(
  c: Omit<PlanConstraint, 'id'>,
  now: Date = new Date(),
): Promise<string> {
  const row = constraintRow(c, now.toISOString());
  await db.insert(planConstraints).values(row);
  return row.id;
}

export async function revokeConstraints(ids: string[], now: Date = new Date()): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(planConstraints)
    .set({ revokedAt: now.toISOString() })
    .where(inArray(planConstraints.id, ids));
}

/** Replaces a calendar day's override atomically (domain/plan/constraints overrideDay). */
export async function setDayTraining(
  date: string,
  train: boolean,
  now: Date = new Date(),
): Promise<void> {
  const at = now.toISOString();
  db.transaction((tx) => {
    const active = tx
      .select()
      .from(planConstraints)
      .where(
        and(
          isNull(planConstraints.revokedAt),
          lte(planConstraints.fromDate, date),
          gte(planConstraints.untilDate, date),
        ),
      )
      .all()
      .map(toConstraint);
    const { revoke, add } = overrideDay(active, date, train);
    if (revoke.length > 0)
      tx.update(planConstraints)
        .set({ revokedAt: at })
        .where(inArray(planConstraints.id, revoke))
        .run();
    for (const c of add) tx.insert(planConstraints).values(constraintRow(c, at)).run();
  });
}
