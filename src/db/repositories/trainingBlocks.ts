import { randomUUID } from 'expo-crypto';

import { desc, eq, isNull } from 'drizzle-orm';

import type { BlockAdvance } from '@/domain/plan/block';
import type { BlockState } from '@/domain/plan/types';

import { db } from '../client';
import { trainingBlocks } from '../schema';

/** The open block as the engine sees it, with the row id to write it back. */
export interface StoredBlock {
  id: string;
  state: BlockState;
}

type BlockRow = typeof trainingBlocks.$inferSelect;

function toState(row: BlockRow): BlockState {
  return {
    index: row.blockIndex,
    startedOn: row.startedOn,
    deloadFrom: row.deloadFrom,
    deloadReason: row.deloadReason,
    selections: row.selections,
  };
}

function toColumns(state: BlockState) {
  return {
    blockIndex: state.index,
    startedOn: state.startedOn,
    deloadFrom: state.deloadFrom,
    deloadReason: state.deloadReason,
    selections: state.selections,
  };
}

/** The open block (no closedOn), or null before the first one. */
export async function getCurrentBlock(): Promise<StoredBlock | null> {
  const [row] = await db
    .select()
    .from(trainingBlocks)
    .where(isNull(trainingBlocks.closedOn))
    .orderBy(desc(trainingBlocks.blockIndex))
    .limit(1);
  return row ? { id: row.id, state: toState(row) } : null;
}

/**
 * Writes what `advanceBlock` decided for `asOf`: closes the old block and
 * opens the next, opens the first one, or updates the open one when
 * anything changed. Calling it twice with the same result writes nothing.
 */
export async function saveBlockAdvance(
  current: StoredBlock | null,
  advance: BlockAdvance,
  asOf: string,
  now: Date = new Date(),
): Promise<StoredBlock> {
  const updatedAt = now.toISOString();
  if (current === null || advance.closed !== null) {
    const id = randomUUID();
    db.transaction((tx) => {
      if (current !== null) {
        tx.update(trainingBlocks)
          .set({ closedOn: asOf, updatedAt })
          .where(eq(trainingBlocks.id, current.id))
          .run();
      }
      tx.insert(trainingBlocks)
        .values({ id, ...toColumns(advance.block), closedOn: null, updatedAt })
        .run();
    });
    return { id, state: advance.block };
  }
  if (JSON.stringify(current.state) !== JSON.stringify(advance.block)) {
    await db
      .update(trainingBlocks)
      .set({ ...toColumns(advance.block), updatedAt })
      .where(eq(trainingBlocks.id, current.id));
  }
  return { id: current.id, state: advance.block };
}

/** "Swap for the rest of the block": the slot uses this exercise until the block ends. */
export async function setBlockSelection(
  blockId: string,
  slotId: string,
  exerciseId: string,
  now: Date = new Date(),
): Promise<void> {
  const [row] = await db
    .select({ selections: trainingBlocks.selections })
    .from(trainingBlocks)
    .where(eq(trainingBlocks.id, blockId))
    .limit(1);
  if (!row) return;
  await db
    .update(trainingBlocks)
    .set({ selections: { ...row.selections, [slotId]: exerciseId }, updatedAt: now.toISOString() })
    .where(eq(trainingBlocks.id, blockId));
}
