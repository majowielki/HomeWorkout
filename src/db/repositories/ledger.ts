import { eq, lt, sql } from 'drizzle-orm';

import { db, type Executor } from '../client';
import { commandLedger, planningRevisions } from '../schema';

/**
 * The command ledger (02 §6): every command that changed something, with the
 * answer it gave. A command sent again — a double tap, a retry after the
 * answer was lost — is answered from here and changes nothing.
 */
export interface LedgerEntry {
  commandId: string;
  kind: string;
  workoutId: string | null;
  result: unknown;
}

export function findCommand(tx: Executor, commandId: string): LedgerEntry | null {
  const row = tx.select().from(commandLedger).where(eq(commandLedger.commandId, commandId)).get();
  return row ? { commandId, kind: row.kind, workoutId: row.workoutId, result: row.result } : null;
}

export function recordCommand(tx: Executor, entry: LedgerEntry, now: Date): void {
  tx.insert(commandLedger)
    .values({
      commandId: entry.commandId,
      kind: entry.kind,
      workoutId: entry.workoutId,
      result: entry.result,
      createdAt: now.toISOString(),
    })
    .run();
}

/** Forgets commands older than `days`: a retry comes seconds later, not months. */
export async function pruneLedger(now: Date, days = 90): Promise<void> {
  const cutoff = new Date(now.getTime() - days * 24 * 3600 * 1000).toISOString();
  await db.delete(commandLedger).where(lt(commandLedger.createdAt, cutoff));
}

/** The kinds of input a plan depends on; each has a counter that a write to it raises (01 §4). */
export type RevisionDomain =
  'history' | 'profile' | 'catalog' | 'inventory' | 'requests' | 'block' | 'preferences';

export const REVISION_DOMAINS = [
  'history',
  'profile',
  'catalog',
  'inventory',
  'requests',
  'block',
  'preferences',
] as const satisfies readonly RevisionDomain[];

/** Raises the counter of a domain and returns the new value. Called in the transaction of the write. */
export function bumpRevision(tx: Executor, domain: RevisionDomain): number {
  tx.insert(planningRevisions)
    .values({ domain, revision: 1 })
    .onConflictDoUpdate({
      target: planningRevisions.domain,
      set: { revision: sql`${planningRevisions.revision} + 1` },
    })
    .run();
  return readRevision(tx, domain);
}

export function readRevision(tx: Executor, domain: RevisionDomain): number {
  return (
    tx
      .select({ revision: planningRevisions.revision })
      .from(planningRevisions)
      .where(eq(planningRevisions.domain, domain))
      .get()?.revision ?? 0
  );
}
