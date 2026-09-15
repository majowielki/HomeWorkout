import { z } from 'zod';

import {
  BACKUP_SCHEMA_VERSION,
  backupEnvelopeSchema,
  backupFileSchema,
  type BackupFile,
} from './format';

export type ParseFailure =
  /** Not even JSON — probably the wrong file. */
  | 'not_json'
  /** JSON, but without our envelope (`app`, `schemaVersion`). */
  | 'not_a_backup'
  /** Written by a newer app; this build cannot know what changed. */
  | 'newer_version'
  /** Right envelope, but a row failed validation; `detail` says which. */
  | 'invalid';

export type ParseResult =
  { ok: true; data: BackupFile } | { ok: false; reason: ParseFailure; detail?: string };

/**
 * Lifts a document from `fromVersion` to `fromVersion + 1`. Keyed by the
 * version being migrated *from*; each step only needs to know about the
 * shape immediately before its own. Empty until the format first changes.
 */
const MIGRATIONS: Record<number, (json: unknown) => unknown> = {};

function migrateToCurrent(json: unknown, fromVersion: number): unknown {
  let doc = json;
  for (let v = fromVersion; v < BACKUP_SCHEMA_VERSION; v += 1) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`no backup migration from schema version ${v}`);
    doc = step(doc);
  }
  return doc;
}

/**
 * Turns file contents into a validated backup, migrating older formats on
 * the way. Never throws on bad input — the import screen needs a reason it
 * can show, not a stack trace.
 */
export function parseBackup(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not_json' };
  }

  const envelope = backupEnvelopeSchema.safeParse(json);
  if (!envelope.success) return { ok: false, reason: 'not_a_backup' };
  if (envelope.data.schemaVersion > BACKUP_SCHEMA_VERSION) {
    return { ok: false, reason: 'newer_version' };
  }

  const parsed = backupFileSchema.safeParse(migrateToCurrent(json, envelope.data.schemaVersion));
  if (!parsed.success) {
    return { ok: false, reason: 'invalid', detail: z.prettifyError(parsed.error) };
  }
  return { ok: true, data: parsed.data };
}
