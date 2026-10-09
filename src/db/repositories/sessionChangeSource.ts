/** Fresh consultation inputs read through one SQLite transaction; no UI snapshot or cached actual. */
import { and, asc, eq, isNull } from 'drizzle-orm';
import slotsJson from '@data/slots.json';
import lexiconJson from '@data/movement-terms.json';
import { slotCatalogueSchema } from '@data/slots.schema';
import { movementLexiconSchema } from '@data/movement-terms.schema';
import { fingerprint } from '@/domain/fingerprint';
import { defaultPreferences, trainingPreferencesSchema } from '@/domain/preferences/preferences';
import { DEFAULT_MODEL_CONTEXT } from '@/domain/resistance/registry';
import { addDays } from '@/domain/time/trainingDate';
import type { SessionPlanV2 } from '@/domain/plan/planV2';
import type { SessionChangeSnapshot } from '@/domain/session/types';
import { db, type Executor } from '../client';
import {
  bands,
  cardioLogs,
  dailyLogs,
  exercises,
  plannedDays,
  planConstraints,
  preferences,
  trainingBlocks,
  userProfile,
  workouts,
} from '../schema';
import { readRevision } from './ledger';
import { readNormalizedHistory } from './historyV2';

const slots = slotCatalogueSchema.parse(slotsJson).slots;
const lexicon = movementLexiconSchema.parse(lexiconJson);

export function readSessionChangeSource(tx: Executor, plan: SessionPlanV2) {
  const asOf = plan.trainingDate;
  const profile = tx.select().from(userProfile).where(eq(userProfile.id, 1)).get();
  const prefs = tx.select().from(preferences).where(eq(preferences.id, 1)).get();
  const catalogRows = tx.select().from(exercises).orderBy(asc(exercises.id)).all();
  const bandRows = tx.select().from(bands).orderBy(asc(bands.id)).all();
  const block = tx.select().from(trainingBlocks).where(isNull(trainingBlocks.closedOn)).get();
  const history = readNormalizedHistory(
    tx,
    tx.select().from(workouts).orderBy(asc(workouts.trainingDate), asc(workouts.id)).all(),
  );
  const inputs = {
    asOf,
    catalog: Object.fromEntries(catalogRows.map((r) => [r.id, r.data])),
    slots,
    lexicon,
    eligibility: {
      profile: { knee: profile?.kneeProfile ?? null },
      excludedIds: new Set(profile?.excludedExerciseIds ?? []),
    },
    block:
      block === undefined
        ? {
            index: 1,
            startedOn: asOf,
            deloadFrom: null,
            deloadReason: null,
            selections: Object.fromEntries(
              plan.exposures
                .filter((e) => e.slotId !== null)
                .map((e) => [e.slotId!, e.exercise.id]),
            ),
          }
        : {
            index: block.blockIndex,
            startedOn: block.startedOn,
            deloadFrom: block.deloadFrom,
            deloadReason: block.deloadReason,
            selections: block.selections,
          },
    records: history.records,
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
    tomorrow:
      tx
        .select()
        .from(plannedDays)
        .where(and(eq(plannedDays.date, addDays(asOf, 1)), eq(plannedDays.seq, 1)))
        .get()?.selection ?? null,
    historyRevision: readRevision(tx, 'history'),
    prefsRevision: prefs?.revision ?? 0,
    revisions: Object.fromEntries(
      ['profile', 'catalog', 'inventory', 'requests', 'block', 'preferences'].map((d) => [
        d,
        readRevision(tx, d as Parameters<typeof readRevision>[1]),
      ]),
    ),
  };
  const snapshotFingerprint = fingerprint(inputs);
  const snap: SessionChangeSnapshot = {
    ...inputs,
    session: {
      sessionId: plan.sessionId,
      planRevision: plan.planRevision,
      kind: plan.kind === 'extra' ? 'extra' : 'main',
      versions: {
        ...plan.versions,
        catalog: String(Math.max(0, ...catalogRows.map((r) => r.dataVersion))),
      },
      snapshotFingerprint,
      inputFingerprint: snapshotFingerprint,
    },
  };
  return {
    snap,
    session: { plan, records: history.records.filter((r) => r.sessionId === plan.sessionId) },
    problems: history.problems,
  };
}

/** Read-only preview boundary. Acceptance uses the same builder again inside its write transaction. */
export function loadSessionChangeSource(sessionId: string) {
  return db.transaction((tx) => {
    const row = tx.select().from(workouts).where(eq(workouts.id, sessionId)).get();
    if (row?.planSchema !== 2 || row.planV2 === null) return null;
    return readSessionChangeSource(tx, row.planV2);
  });
}
