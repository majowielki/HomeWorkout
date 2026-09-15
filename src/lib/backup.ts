import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { backupFileName, type BackupFile } from '@/db/backup/format';
import { parseBackup, type ParseResult } from '@/db/backup/parse';
import { dumpAll, restoreAll } from '@/db/repositories/backup';
import { pl } from '@/strings/pl';

import { syncReminders } from './reminders';

const MIME = 'application/json';
const SAFETY_DIR = 'backups';
/** Pre-import snapshots kept on disk; older ones are pruned. */
const SAFETY_KEEP = 5;

function writeJson(file: File, data: BackupFile): void {
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(data, null, 2));
}

/**
 * Dumps the database to the cache directory and hands the file to the
 * system share sheet — Drive, mail, "save to Files". The cache copy is
 * disposable; the share target owns the real copy.
 */
export async function exportBackup(now: Date = new Date()): Promise<File> {
  const data = await dumpAll(now);
  const file = new File(Paths.cache, backupFileName(now));
  writeJson(file, data);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: MIME, dialogTitle: pl.backup.shareTitle });
  }
  return file;
}

export interface SafetyBackup {
  name: string;
  uri: string;
  sizeBytes: number;
  /** ms since epoch, or null when the platform does not report it. */
  modifiedAt: number | null;
}

function safetyDir(): Directory {
  const dir = new Directory(Paths.document, SAFETY_DIR);
  if (!dir.exists) dir.create();
  return dir;
}

/** Newest first. */
export function listSafetyBackups(): SafetyBackup[] {
  const dir = new Directory(Paths.document, SAFETY_DIR);
  if (!dir.exists) return [];
  return dir
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.json'))
    .map((file) => ({
      name: file.name,
      uri: file.uri,
      sizeBytes: file.size,
      modifiedAt: file.modificationTime,
    }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

/**
 * Snapshot of the current state taken right before an import overwrites
 * it, in the app's private document directory (IMPLEMENTACJA §7.5). Named
 * by instant so several in one day do not collide.
 */
export async function writeSafetyBackup(now: Date = new Date()): Promise<File> {
  const data = await dumpAll(now);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const file = new File(safetyDir(), `pre-import-${stamp}.json`);
  writeJson(file, data);

  for (const stale of listSafetyBackups().slice(SAFETY_KEEP)) {
    new File(stale.uri).delete();
  }
  return file;
}

export type PickResult =
  { kind: 'canceled' } | { kind: 'picked'; name: string; parse: ParseResult };

/**
 * Opens the system picker and validates whatever comes back. Any MIME is
 * allowed: Android tags a `.json` from Drive as text/plain or
 * octet-stream often enough that filtering would hide the right file.
 */
export async function pickBackup(): Promise<PickResult> {
  const picked = await File.pickFileAsync({ mimeTypes: '*/*' });
  if (picked.canceled) return { kind: 'canceled' };
  const text = await picked.result.text();
  return { kind: 'picked', name: picked.result.name, parse: parseBackup(text) };
}

export interface ImportSummary {
  safetyBackupName: string;
}

/** Safety snapshot, then the atomic replace, then reminders recomputed from the new state. */
export async function importBackup(data: BackupFile): Promise<ImportSummary> {
  const safety = await writeSafetyBackup();
  await restoreAll(data);
  await syncReminders().catch((e: unknown) => {
    console.warn('reminder sync after import failed', e);
  });
  return { safetyBackupName: safety.name };
}

/** Restores one of the pre-import snapshots — the undo for a mistaken import. */
export async function importSafetyBackup(uri: string): Promise<ParseResult> {
  const parse = parseBackup(await new File(uri).text());
  if (parse.ok) await importBackup(parse.data);
  return parse;
}
