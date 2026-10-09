import { eq } from 'drizzle-orm';

import { backupFileName, type BackupFile } from '../backup/format';
import { parseBackup } from '../backup/parse';
import { db } from '../client';
import {
  appState,
  cardioLogs,
  commandLedger,
  legacySessions,
  planConstraints,
  plannedDays,
  planGenerations,
  planGenerationsV2,
  plannedDaysV2,
  prescriptionAnswers,
  trainingBlocks,
  workouts,
} from '../schema';
import { dumpAll } from './backup';
import { bumpRevision } from './ledger';

/*
 * From the first engine to engine v2 (D21, 02 §8a): the training data starts
 * again from nothing, after everything has been written to a file the person
 * keeps. The order is the whole point — archive first, check that the file
 * is readable, and only then delete — so a failure at any step before the
 * last leaves the data exactly as it was.
 *
 * What is kept: the profile (the knee, the day boundary), the bands with their
 * calibrations, the morning logs, weight and measurements, the templates, the
 * AI diagnostics, the preferences and the list of exercises not to suggest.
 * What goes: sessions and their sets, the blocks, the planned week, the
 * requests to the planner, the rides.
 */

export const ENGINE_GENERATION_KEY = 'engine_generation';

/** 1: the first engine's data. 2: the data starts from engine v2. */
export async function engineGeneration(): Promise<1 | 2> {
  const [row] = await db.select().from(appState).where(eq(appState.key, ENGINE_GENERATION_KEY));
  return row?.value === '2' ? 2 : 1;
}

export function archiveFileName(now: Date): string {
  return backupFileName(now).replace('homeworkout-backup-', 'homeworkout-v1-archive-');
}

export interface ArchiveSink {
  /** Writes the archive where the person can find it; returns where. Throws if it could not. */
  write(text: string, fileName: string): Promise<string>;
  /** Reads it back, so the file that is trusted is the file that was written. */
  read(location: string): Promise<string>;
}

export type EngineMigrationResult =
  | { kind: 'already_migrated' }
  | {
      kind: 'migrated';
      archive: { location: string; fileName: string; bytes: number };
      removed: { sessions: number };
    }
  | { kind: 'failed'; stage: 'archive' | 'verify' | 'reset'; detail: string };

export async function migrateToEngineV2(
  sink: ArchiveSink,
  now: Date = new Date(),
): Promise<EngineMigrationResult> {
  if ((await engineGeneration()) === 2) return { kind: 'already_migrated' };

  const dump = await dumpAll(now);
  const text = JSON.stringify(dump, null, 2);
  const fileName = archiveFileName(now);
  let location: string;
  try {
    location = await sink.write(text, fileName);
  } catch (error) {
    return { kind: 'failed', stage: 'archive', detail: String(error) };
  }
  try {
    const readBack = await sink.read(location);
    const parsed = parseBackup(readBack);
    if (!parsed.ok || readBack !== text) {
      return {
        kind: 'failed',
        stage: 'verify',
        detail: parsed.ok ? 'the file differs from what was written' : parsed.reason,
      };
    }
  } catch (error) {
    return { kind: 'failed', stage: 'verify', detail: String(error) };
  }

  try {
    db.transaction((tx) => {
      // Sessions take their sets, outcomes, skips, plan revisions and how-it-felt with them (ON DELETE CASCADE).
      tx.delete(workouts).run();
      tx.delete(cardioLogs).run();
      tx.delete(trainingBlocks).run();
      tx.delete(plannedDays).run();
      tx.delete(planGenerations).run();
      tx.delete(plannedDaysV2).run();
      tx.delete(planGenerationsV2).run();
      tx.delete(prescriptionAnswers).run();
      tx.delete(planConstraints).run();
      tx.delete(commandLedger).run();
      for (const domain of ['history', 'block', 'requests'] as const) bumpRevision(tx, domain);
      tx.insert(appState)
        .values({ key: ENGINE_GENERATION_KEY, value: '2', updatedAt: now.toISOString() })
        .onConflictDoUpdate({
          target: appState.key,
          set: { value: '2', updatedAt: now.toISOString() },
        })
        .run();
    });
  } catch (error) {
    return { kind: 'failed', stage: 'reset', detail: String(error) };
  }
  return {
    kind: 'migrated',
    archive: { location, fileName, bytes: new TextEncoder().encode(text).length },
    removed: { sessions: dump.tables.workouts.length },
  };
}

/**
 * Puts the sessions of an archive (or of any older backup) among the sessions
 * kept for display (D21). They are not the progression's, not the volume's,
 * and not the planner's: they are read by the history screens and by nothing
 * that decides. Idempotent — importing the same archive twice adds nothing.
 */
export async function importLegacySessions(
  data: BackupFile,
  now: Date = new Date(),
): Promise<{ imported: number }> {
  const setsOf = new Map<string, unknown[]>();
  for (const set of data.tables.set_logs) {
    setsOf.set(set.workoutId, [...(setsOf.get(set.workoutId) ?? []), set]);
  }
  const rows = data.tables.workouts
    .filter((w) => w.planSchema === 1 && w.status !== 'in_progress')
    .map((w) => ({
      id: w.id,
      trainingDate: w.trainingDate,
      startedAt: w.startedAt,
      finishedAt: w.finishedAt,
      status: w.status,
      sessionRpe: w.sessionRpe,
      notes: w.notes,
      plan: w.plan,
      sets: setsOf.get(w.id) ?? [],
      archivedAt: now.toISOString(),
    }));
  let imported = 0;
  db.transaction((tx) => {
    for (const row of rows) {
      const result = tx.insert(legacySessions).values(row).onConflictDoNothing().run();
      imported += result.changes;
    }
  });
  return { imported };
}
