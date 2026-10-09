import { inArray } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import { BACKUP_APP, BACKUP_SCHEMA_VERSION, type BackupFile } from '../backup/format';
import { db, type Tx } from '../client';
import {
  bands,
  bodyMetrics,
  cardioLogs,
  commandLedger,
  dailyLogs,
  exercises,
  exposureOutcomes,
  feelReports,
  measurements,
  legacySessions,
  planConstraints,
  plannedDays,
  planGenerations,
  prescriptionAnswers,
  preferences,
  sessionPlanRevisions,
  setDispositions,
  setLogRevisions,
  setLogs,
  trainingBlocks,
  userProfile,
  workouts,
} from '../schema';
import { bumpRevision, readRevision, REVISION_DOMAINS } from './ledger';
import { ensureProfile } from './profile';
import { refreshOutcomes } from './sessions';

/**
 * Keeps each INSERT under SQLite's bound-parameter ceiling: set_logs has
 * 15 columns, so 50 rows is 750 parameters — comfortably under even the
 * old 999 limit.
 */
const CHUNK = 50;

function insertChunked<T extends SQLiteTable>(
  tx: Tx,
  table: T,
  rows: readonly T['$inferInsert'][],
): void {
  for (let i = 0; i < rows.length; i += CHUNK) {
    tx.insert(table)
      .values(rows.slice(i, i + CHUNK))
      .run();
  }
}

export async function dumpAll(now: Date = new Date()): Promise<BackupFile> {
  const [
    profileRows,
    bandRows,
    workoutRows,
    setRows,
    cardioRows,
    bodyRows,
    measurementRows,
    dailyRows,
    blockRows,
    constraintRows,
    revisionRows,
    dispositionRows,
    planRevisionRows,
    feelRows,
    preferenceRows,
    legacyRows,
  ] = await Promise.all([
    db.select().from(userProfile),
    db.select().from(bands),
    db.select().from(workouts),
    db.select().from(setLogs),
    db.select().from(cardioLogs),
    db.select().from(bodyMetrics),
    db.select().from(measurements),
    db.select().from(dailyLogs),
    db.select().from(trainingBlocks),
    db.select().from(planConstraints),
    db.select().from(setLogRevisions),
    db.select().from(setDispositions),
    db.select().from(sessionPlanRevisions),
    db.select().from(feelReports),
    db.select().from(preferences),
    db.select().from(legacySessions),
  ]);

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    app: BACKUP_APP,
    tables: {
      user_profile: profileRows,
      bands: bandRows,
      workout_templates: [],
      workouts: workoutRows,
      set_logs: setRows,
      cardio_logs: cardioRows,
      body_metrics: bodyRows,
      measurements: measurementRows,
      daily_logs: dailyRows,
      training_blocks: blockRows,
      plan_constraints: constraintRows,
      set_log_revisions: revisionRows,
      set_dispositions: dispositionRows,
      session_plan_revisions: planRevisionRows,
      feel_reports: feelRows,
      preferences: preferenceRows,
      legacy_sessions: legacyRows,
    },
  };
}

export class UnknownExerciseError extends Error {
  constructor(public readonly ids: string[]) {
    super(`backup references exercises missing from the catalogue: ${ids.join(', ')}`);
    this.name = 'UnknownExerciseError';
  }
}

/**
 * Replaces every user table with the backup's contents, atomically.
 *
 * Exercises are the one table not in the file, so a set log pointing at an
 * id this build has never shipped is checked up front — the alternative is
 * a foreign-key error from the middle of the transaction with no useful
 * message. Everything else (templates for workouts, bands for sets) comes
 * from the same file and is inserted in dependency order.
 */
export async function restoreAll(data: BackupFile): Promise<void> {
  const referenced = [...new Set(data.tables.set_logs.map((s) => s.exerciseId))];
  if (referenced.length > 0) {
    const known = new Set(
      (
        await db
          .select({ id: exercises.id })
          .from(exercises)
          .where(inArray(exercises.id, referenced))
      ).map((r) => r.id),
    );
    const missing = referenced.filter((id) => !known.has(id));
    if (missing.length > 0) throw new UnknownExerciseError(missing);
  }

  db.transaction((tx) => {
    // Children before parents, so the foreign keys never complain.
    tx.delete(setLogRevisions).run();
    tx.delete(setLogs).run();
    tx.delete(setDispositions).run();
    tx.delete(exposureOutcomes).run();
    tx.delete(sessionPlanRevisions).run();
    tx.delete(feelReports).run();
    tx.delete(cardioLogs).run();
    tx.delete(workouts).run();
    tx.delete(bands).run();
    tx.delete(bodyMetrics).run();
    tx.delete(measurements).run();
    tx.delete(dailyLogs).run();
    tx.delete(trainingBlocks).run();
    tx.delete(planConstraints).run();
    // The planned week follows from the logs being replaced: it is planned again.
    tx.delete(plannedDays).run();
    tx.delete(planGenerations).run();
    // The answers belong to exposures of the history that is being replaced.
    tx.delete(prescriptionAnswers).run();
    tx.delete(userProfile).run();
    tx.delete(preferences).run();
    tx.delete(legacySessions).run();
    // A command of the history that was replaced means nothing to the one that replaces it.
    tx.delete(commandLedger).run();

    insertChunked(tx, userProfile, data.tables.user_profile);
    insertChunked(tx, bands, data.tables.bands);
    insertChunked(
      tx,
      workouts,
      data.tables.workouts.map((row) =>
        row.planSchema === 1 && row.status === 'in_progress'
          ? { ...row, status: 'abandoned' as const, finishedAt: row.finishedAt ?? data.exportedAt }
          : row,
      ),
    );
    insertChunked(tx, setLogs, data.tables.set_logs);
    insertChunked(tx, setLogRevisions, data.tables.set_log_revisions);
    insertChunked(tx, setDispositions, data.tables.set_dispositions);
    insertChunked(tx, sessionPlanRevisions, data.tables.session_plan_revisions);
    insertChunked(tx, feelReports, data.tables.feel_reports);
    insertChunked(tx, preferences, data.tables.preferences);
    insertChunked(tx, legacySessions, data.tables.legacy_sessions);
    insertChunked(tx, cardioLogs, data.tables.cardio_logs);
    insertChunked(tx, bodyMetrics, data.tables.body_metrics);
    insertChunked(tx, measurements, data.tables.measurements);
    insertChunked(tx, dailyLogs, data.tables.daily_logs);
    insertChunked(tx, trainingBlocks, data.tables.training_blocks);
    insertChunked(tx, planConstraints, data.tables.plan_constraints);

    // The history is another one now: every plan, preview and card made on the old one is stale,
    // and the stored outcomes of the sessions are built again from what the file brought.
    for (const domain of REVISION_DOMAINS) bumpRevision(tx, domain);
    const history = readRevision(tx, 'history');
    for (const workout of tx.select().from(workouts).all()) {
      if (workout.planSchema === 2 && workout.sessionPlan !== null) {
        refreshOutcomes(tx, workout, workout.sessionPlan, history);
      }
    }

    // A file with an empty profile table would otherwise leave the app
    // without its one row; the seed would fix it on next start, but the
    // screens read it immediately.
    ensureProfile(new Date().toISOString(), tx);
  });
}
