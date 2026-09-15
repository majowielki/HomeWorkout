import { inArray } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import { BACKUP_APP, BACKUP_SCHEMA_VERSION, type BackupFile } from '../backup/format';
import { db } from '../client';
import {
  bands,
  bodyMetrics,
  cardioLogs,
  dailyLogs,
  exercises,
  measurements,
  setLogs,
  userProfile,
  workouts,
  workoutTemplates,
} from '../schema';
import { ensureProfile } from './profile';

/**
 * Keeps each INSERT under SQLite's bound-parameter ceiling: set_logs has
 * 15 columns, so 50 rows is 750 parameters — comfortably under even the
 * old 999 limit.
 */
const CHUNK = 50;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function insertChunked<T extends SQLiteTable>(
  tx: Tx,
  table: T,
  rows: readonly T['$inferInsert'][],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx.insert(table).values(rows.slice(i, i + CHUNK));
  }
}

export async function dumpAll(now: Date = new Date()): Promise<BackupFile> {
  const [
    profileRows,
    bandRows,
    templateRows,
    workoutRows,
    setRows,
    cardioRows,
    bodyRows,
    measurementRows,
    dailyRows,
  ] = await Promise.all([
    db.select().from(userProfile),
    db.select().from(bands),
    db.select().from(workoutTemplates),
    db.select().from(workouts),
    db.select().from(setLogs),
    db.select().from(cardioLogs),
    db.select().from(bodyMetrics),
    db.select().from(measurements),
    db.select().from(dailyLogs),
  ]);

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    app: BACKUP_APP,
    tables: {
      user_profile: profileRows,
      bands: bandRows,
      workout_templates: templateRows,
      workouts: workoutRows,
      set_logs: setRows,
      cardio_logs: cardioRows,
      body_metrics: bodyRows,
      measurements: measurementRows,
      daily_logs: dailyRows,
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

  await db.transaction(async (tx) => {
    // Children before parents, so the foreign keys never complain.
    await tx.delete(setLogs);
    await tx.delete(cardioLogs);
    await tx.delete(workouts);
    await tx.delete(workoutTemplates);
    await tx.delete(bands);
    await tx.delete(bodyMetrics);
    await tx.delete(measurements);
    await tx.delete(dailyLogs);
    await tx.delete(userProfile);

    await insertChunked(tx, userProfile, data.tables.user_profile);
    await insertChunked(tx, bands, data.tables.bands);
    await insertChunked(tx, workoutTemplates, data.tables.workout_templates);
    await insertChunked(tx, workouts, data.tables.workouts);
    await insertChunked(tx, setLogs, data.tables.set_logs);
    await insertChunked(tx, cardioLogs, data.tables.cardio_logs);
    await insertChunked(tx, bodyMetrics, data.tables.body_metrics);
    await insertChunked(tx, measurements, data.tables.measurements);
    await insertChunked(tx, dailyLogs, data.tables.daily_logs);

    // A file with an empty profile table would otherwise leave the app
    // without its one row; the seed would fix it on next start, but the
    // screens read it immediately.
    await ensureProfile(new Date().toISOString(), tx);
  });
}
