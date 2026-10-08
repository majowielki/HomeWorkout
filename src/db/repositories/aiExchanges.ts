import { randomUUID } from 'expo-crypto';

import { desc, notInArray } from 'drizzle-orm';

import type { ExchangeRecord } from '@/ai/client/exchange';

import { db } from '../client';
import { aiExchanges } from '../schema';

export type AiExchangeRow = typeof aiExchanges.$inferSelect;

/**
 * How many exchanges to keep. Each holds the full context that was sent
 * (a few tens of kilobytes), so the log is bounded rather than left to
 * grow for years.
 */
export const KEEP_EXCHANGES = 50;

export async function recordExchange(
  record: ExchangeRecord,
  now: Date = new Date(),
): Promise<string> {
  const id = randomUUID();
  await db.insert(aiExchanges).values({
    id,
    kind: record.kind,
    requestId: record.requestId,
    createdAt: now.toISOString(),
    promptVersion: record.promptVersion,
    model: record.model,
    latencyMs: record.latencyMs,
    tokensIn: record.tokensIn,
    tokensOut: record.tokensOut,
    attempts: record.attempts,
    outcome: record.outcome,
    request: record.request,
    response: record.response,
    accepted: null,
  });

  const keep = await db
    .select({ id: aiExchanges.id })
    .from(aiExchanges)
    .orderBy(desc(aiExchanges.createdAt))
    .limit(KEEP_EXCHANGES);
  if (keep.length === KEEP_EXCHANGES) {
    await db.delete(aiExchanges).where(
      notInArray(
        aiExchanges.id,
        keep.map((row) => row.id),
      ),
    );
  }
  return id;
}

export async function listExchanges(limit = KEEP_EXCHANGES): Promise<AiExchangeRow[]> {
  return db.select().from(aiExchanges).orderBy(desc(aiExchanges.createdAt)).limit(limit);
}

export async function clearExchanges(): Promise<void> {
  await db.delete(aiExchanges);
}
