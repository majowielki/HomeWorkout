/**
 * What the engine reads of the database, as plain domain data (engine, 01 §2, §4).
 *
 * One reader for the day, the extra session and the consultation in a session,
 * so that they cannot see different histories. It runs inside the caller's
 * transaction: what it returns is one consistent state, and the revisions in it
 * are the ones of that state.
 */
import { asc, eq, isNull } from 'drizzle-orm';
import slotsJson from '@data/slots.json';
import { slotCatalogueSchema } from '@data/slots.schema';
import type { LoadedHistory } from './history';
import { defaultPreferences, trainingPreferencesSchema } from '@/domain/preferences/preferences';
import { DEFAULT_MODEL_CONTEXT } from '@/domain/resistance/registry';
import { DEFAULT_DAY_BOUNDARY_HOUR } from '@/domain/time/trainingDate';
import type { Executor } from '../client';
import {
  bands,
  cardioLogs,
  dailyLogs,
  exercises,
  planConstraints,
  preferences,
  userProfile,
  workouts,
} from '../schema';
import { readNormalizedHistory } from './history';
import { readAnswers } from './answers';
import { readRevision } from './ledger';

export const SLOTS = slotCatalogueSchema.parse(slotsJson).slots;

/** The hour at which a training day begins, which the date of "today" is derived from. */
export function readDayBoundaryHour(tx: Executor): number {
  return (
    tx
      .select({ hour: userProfile.dayBoundaryHour })
      .from(userProfile)
      .where(eq(userProfile.id, 1))
      .get()?.hour ?? DEFAULT_DAY_BOUNDARY_HOUR
  );
}

export function readPlanningInputs(tx: Executor, asOf: string) {
  const profile = tx.select().from(userProfile).where(eq(userProfile.id, 1)).get();
  const prefs = tx.select().from(preferences).where(eq(preferences.id, 1)).get();
  const catalogRows = tx.select().from(exercises).orderBy(asc(exercises.id)).all();
  const bandRows = tx.select().from(bands).orderBy(asc(bands.id)).all();
  const history: LoadedHistory = readNormalizedHistory(
    tx,
    tx.select().from(workouts).orderBy(asc(workouts.trainingDate), asc(workouts.id)).all(),
  );
  const common = {
    asOf,
    catalog: Object.fromEntries(catalogRows.map((r) => [r.id, r.data])),
    slots: SLOTS,
    eligibility: {
      profile: { knee: profile?.kneeProfile ?? null },
      excludedIds: new Set(profile?.excludedExerciseIds ?? []),
    },
    records: history.records,
    answers: readAnswers(tx, history.records),
    daily: tx
      .select()
      .from(dailyLogs)
      .orderBy(asc(dailyLogs.date))
      .all()
      .map((d) => ({
        date: d.date,
        sleepHours: d.sleepHours,
        energy: d.energy,
        soreness: d.soreness,
      })),
    rides: tx
      .select()
      .from(cardioLogs)
      .orderBy(asc(cardioLogs.trainingDate), asc(cardioLogs.id))
      .all()
      .map((r) => ({
        date: r.trainingDate,
        minutes: r.minutes,
        resistance: r.resistanceLevel,
        rpe: r.rpe,
      })),
    constraints: tx
      .select()
      .from(planConstraints)
      .where(isNull(planConstraints.revokedAt))
      .orderBy(asc(planConstraints.id))
      .all()
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        muscles: c.muscles,
        from: c.fromDate,
        until: c.untilDate,
        reason: c.reason,
        source: c.source,
        note: c.note,
        ...(c.items === null ? {} : { items: c.items }),
      })),
    week: { restWeekdays: profile?.restWeekdays ?? [] },
    preferences:
      prefs === undefined ? defaultPreferences() : trainingPreferencesSchema.parse(prefs.data),
    models: {
      ...DEFAULT_MODEL_CONTEXT,
      bands: bandRows.map(({ id, label, nominalMinKg, nominalMaxKg }) => ({
        id,
        label,
        nominalMinKg,
        nominalMaxKg,
      })),
      bandCalibrations: Object.fromEntries(bandRows.map((b) => [b.id, b.calibration])),
    },
    historyRevision: readRevision(tx, 'history'),
    prefsRevision: prefs?.revision ?? 0,
    revisions: Object.fromEntries(
      ['profile', 'catalog', 'inventory', 'requests', 'block', 'preferences'].map((d) => [
        d,
        readRevision(tx, d as Parameters<typeof readRevision>[1]),
      ]),
    ),
  };
  return {
    common,
    history,
    /** The newest data version of the catalogue rows: the plan says which catalogue it was made from. */
    catalogVersion: String(Math.max(0, ...catalogRows.map((r) => r.dataVersion))),
  };
}
