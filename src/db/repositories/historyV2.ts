import { and, asc, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import {
  type FeelReport,
  normalizeObservations,
  type ObservationRow,
  type SessionMeta,
} from '@/domain/observations/normalize';
import type { ExposureRecord } from '@/domain/observations/exposure';
import type { SetDisposition } from '@/domain/observations/types';

import { db, type Executor } from '../client';
import { feelReports, sessionPlanRevisions, setDispositions, setLogs, workouts } from '../schema';
import type { SessionPlanV2 } from '@/domain/plan/planV2';

/*
 * The read side of engine v2: the sessions of a period, normalized into the
 * exposures the progression and the planners read (13 §3, §13).
 *
 * Two reads, because two questions. The *window* is what happened lately —
 * volume, recovery, the streak of an exercise. The *last comparable* of each
 * key has no age: an exercise that comes back after half a year still has a
 * past, found by a query on the key and not by widening the window (T34).
 */

type WorkoutRow = typeof workouts.$inferSelect;

export interface LoadedHistory {
  records: ExposureRecord[];
  problems: ReturnType<typeof normalizeObservations>['problems'];
  unassigned: ReturnType<typeof normalizeObservations>['unassigned'];
}

/** Cumulative prescriptions for history only: removed sets stay expected and have stored skips. */
export function historyPlans(tx: Executor, sessions: readonly WorkoutRow[]): SessionPlanV2[] {
  return sessions
    .filter((w) => w.planSchema === 2 && w.planV2 !== null)
    .map((w) => {
      const revisions = tx
        .select()
        .from(sessionPlanRevisions)
        .where(sql`${sessionPlanRevisions.workoutId} = ${w.id}`)
        .orderBy(asc(sessionPlanRevisions.planRevision))
        .all();
      const exposures = new Map<string, SessionPlanV2['exposures'][number]>();
      for (const plan of [...revisions.map((r) => r.plan), w.planV2!]) {
        for (const e of plan.exposures) {
          const previous = exposures.get(e.id);
          const sets = new Map(previous?.sets.map((s) => [s.id, s]) ?? []);
          for (const s of e.sets) sets.set(s.id, s);
          exposures.set(e.id, { ...e, sets: [...sets.values()] });
        }
      }
      return { ...w.planV2!, exposures: [...exposures.values()] };
    });
}

/** Synchronous reads through the supplied transaction, also used during session change acceptance. */
export function readNormalizedHistory(tx: Executor, sessions: WorkoutRow[]): LoadedHistory {
  const withPlans = sessions.filter((w) => w.planSchema === 2 && w.planV2 !== null);
  if (withPlans.length === 0) return { records: [], problems: [], unassigned: [] };
  const ids = withPlans.map((w) => w.id);
  const setRows = tx.select().from(setLogs).where(inArray(setLogs.workoutId, ids)).all();
  const skipRows = tx
    .select()
    .from(setDispositions)
    .where(inArray(setDispositions.workoutId, ids))
    .all();
  const feelRows = tx.select().from(feelReports).where(inArray(feelReports.workoutId, ids)).all();
  const plans = historyPlans(tx, withPlans);
  const observations: ObservationRow[] = setRows.flatMap((row) =>
    row.observation === null
      ? []
      : [{ ...row.observation, revision: row.revision, deletedAt: row.deletedAt }],
  );
  const dispositions: SetDisposition[] = skipRows.map((d) => ({
    plannedSetId: d.plannedSetId,
    status: d.status,
    reason: d.reason as SetDisposition['reason'],
    commandId: d.commandId,
    at: d.at,
  }));
  const feel: FeelReport[] = feelRows.map((f) => ({
    sessionId: f.workoutId,
    exposureId: f.exposureId,
    feel: f.feel,
    channel: f.channel,
    at: f.at,
  }));
  const sessionMeta: SessionMeta[] = withPlans.map((w) => ({
    sessionId: w.id,
    trainingDate: w.trainingDate,
    status: w.status,
    deload: w.planV2!.exposures.some((e) => e.trace.code === 'DELOAD'),
    reducedExposures: plans
      .find((p) => p.sessionId === w.id)!
      .exposures.filter(
        (e) =>
          e.sets.some((s) =>
            skipRows.some(
              (d) => d.workoutId === w.id && d.plannedSetId === s.id && d.reason === 'replaced',
            ),
          ) || e.trace.evidence.reducedFrom !== undefined,
      )
      .map((e) => e.id),
  }));
  return normalizeObservations({
    sessions: sessionMeta,
    plans,
    observations,
    dispositions,
    feel,
  });
}

/** Every session of engine v2 on or after a date, abandoned and running ones included. */
export async function loadWindow(from: string): Promise<LoadedHistory> {
  const rows = await db.select().from(workouts).where(gte(workouts.trainingDate, from));
  return readNormalizedHistory(db, rows);
}

/**
 * For each comparison key, its newest primary exposure from before `before` —
 * the reading of an exercise that has not been done lately (T34). The key and
 * the day come from an indexed query; only the sessions that hold them are loaded.
 */
export async function loadLastComparableBefore(before: string): Promise<ExposureRecord[]> {
  const newest = await db
    .select({
      key: setLogs.comparisonKey,
      day: sql<string>`max(${setLogs.performedOn})`,
    })
    .from(setLogs)
    .where(
      and(
        isNotNull(setLogs.comparisonKey),
        isNull(setLogs.deletedAt),
        lt(setLogs.performedOn, before),
        sql`${setLogs.progressionScope} = 'primary'`,
      ),
    )
    .groupBy(setLogs.comparisonKey);
  if (newest.length === 0) return [];
  const days = [...new Set(newest.map((n) => n.day))];
  const candidates = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(inArray(workouts.trainingDate, days));
  const sessions = await db
    .select()
    .from(workouts)
    .where(
      inArray(
        workouts.id,
        candidates.map((c) => c.id),
      ),
    );
  const { records } = readNormalizedHistory(db, sessions);
  const wanted = new Map(newest.map((n) => [n.key, n.day]));
  const last = new Map<string, ExposureRecord>();
  for (const record of records) {
    if (
      record.progressionScope !== 'primary' ||
      wanted.get(record.comparisonKey) !== record.trainingDate
    ) {
      continue;
    }
    const known = last.get(record.comparisonKey);
    if (!known || known.exposureId < record.exposureId) last.set(record.comparisonKey, record);
  }
  return [...last.values()];
}

/**
 * Everything the planners need of the history: the window, plus the newest
 * result of every key from before it. The records are not mixed up — the
 * older ones are only the "last time" of an exercise, and the index treats them so.
 */
export async function loadHistoryForPlanning(
  windowStart: string,
): Promise<LoadedHistory & { older: ExposureRecord[] }> {
  const [window, older] = await Promise.all([
    loadWindow(windowStart),
    loadLastComparableBefore(windowStart),
  ]);
  return { ...window, older };
}
