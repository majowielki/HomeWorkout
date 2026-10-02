import { z } from 'zod';

import type { Slot } from '../src/domain/plan/types';

const range = (min: number, max: number) =>
  z
    .tuple([z.number().int().min(min).max(max), z.number().int().min(min).max(max)])
    .refine(([lo, hi]) => lo <= hi, { message: 'range must be [min, max] with min <= max' });

const kgOnSomeLadder = z.number().int().min(2).max(18);

export const slotSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  kind: z.enum(['compound', 'accessory', 'core', 'filler']),
  region: z.enum(['lower', 'push', 'pull', 'shoulders', 'arms', 'core', 'mobility']),
  exerciseIds: z.array(z.string().min(1)).min(1),
  repRange: range(1, 30).optional(),
  timeRange: range(5, 300).optional(),
  rir: range(0, 5),
  restSec: z.number().int().min(15).max(300),
  start: z.object({
    paired: kgOnSomeLadder.optional(),
    single: kgOnSomeLadder.optional(),
    band: z.string().min(1).optional(),
  }),
}) satisfies z.ZodType<Slot>;

export const slotCatalogueSchema = z.object({
  version: z.number().int().positive(),
  slots: z.array(slotSchema).min(1),
});

export type SlotCatalogue = z.infer<typeof slotCatalogueSchema>;
