/**
 * The volume lever on the phone (engine, 13 §19, D32): the cards the engine would put in front of the
 * person, and the one thing accepting a card does — the maximum of that muscle becomes the person's own
 * (`volumeOverrides`) and every plan made on the old preferences is stale. The engine never raises
 * or lowers the volume by itself.
 */
import { eq } from 'drizzle-orm';

import { defaultPreferences, trainingPreferencesSchema } from '@/domain/preferences/preferences';
import { trainingDate } from '@/domain/time/trainingDate';
import { volumeCardsFor } from '@/domain/volume/cards';
import type { VolumeCard } from '@/domain/volume/lever';

import { db, type Tx } from '../client';
import { preferences } from '../schema';
import { bumpRevision } from './ledger';
import { readDayBoundaryHour, readPlanningInputs } from './planningInputs';
import { readBlocks } from './trainingBlocks';

function cardsIn(tx: Tx, now: Date): VolumeCard[] {
  const asOf = trainingDate(now, readDayBoundaryHour(tx));
  const { common } = readPlanningInputs(tx, asOf);
  return volumeCardsFor({
    asOf,
    catalog: common.catalog,
    slots: common.slots,
    block: readBlocks(tx).current?.state ?? null,
    records: common.records,
    daily: common.daily,
    preferences: common.preferences,
    models: common.models,
  });
}

/** The cards for today. Writes nothing. */
export function readVolumeCards(now: Date = new Date()): VolumeCard[] {
  return db.transaction((tx) => cardsIn(tx, now));
}

/**
 * Takes a card: the maximum of the muscle becomes the one it shows. The card is checked against the
 * engine's reading now, so a card that has gone stale in the meantime changes nothing. True when it was applied.
 */
export function acceptVolumeCard(
  card: Pick<VolumeCard, 'muscle' | 'toMax'>,
  now: Date = new Date(),
): boolean {
  return db.transaction((tx) => {
    if (!cardsIn(tx, now).some((c) => c.muscle === card.muscle && c.toMax === card.toMax)) {
      return false;
    }
    const row = tx.select().from(preferences).where(eq(preferences.id, 1)).get();
    const current =
      row === undefined ? defaultPreferences() : trainingPreferencesSchema.parse(row.data);
    const revision = (row?.revision ?? 0) + 1;
    const next = trainingPreferencesSchema.parse({
      ...current,
      revision,
      volumeOverrides: { ...current.volumeOverrides, [card.muscle]: card.toMax },
    });
    const values = { data: next, revision, updatedAt: now.toISOString() };
    tx.insert(preferences)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: preferences.id, set: values })
      .run();
    bumpRevision(tx, 'preferences');
    return true;
  });
}
