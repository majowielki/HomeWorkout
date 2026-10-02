import slotCatalogue from '@data/slots.json';
import { slotCatalogueSchema } from '@data/slots.schema';
import type { Slot } from '@/domain/plan/types';

/**
 * The movement slots shipped with the app (SPEC §10.1). Read from the
 * bundle, not the database: there is no editor, and `validate:data` has
 * already checked them in CI.
 */
export const SLOTS: readonly Slot[] = slotCatalogueSchema.parse(slotCatalogue).slots;

export const SLOT_BY_ID: ReadonlyMap<string, Slot> = new Map(SLOTS.map((s) => [s.id, s]));
