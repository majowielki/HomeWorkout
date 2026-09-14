import { z } from 'zod';

export const templateBlockSchema = z
  .object({
    label: z.string().regex(/^[A-Za-z]\d+$/, 'label must look like A1, B2, C3'),
    exerciseId: z.string(),
    sets: z.number().int().min(1).max(6),
    repMin: z.number().int().min(1).max(60).optional(),
    repMax: z.number().int().min(1).max(60).optional(),
    timeSec: z.number().int().min(5).max(300).optional(),
    targetRirMin: z.number().int().min(0).max(5),
    targetRirMax: z.number().int().min(0).max(5),
    restSec: z.number().int().min(15).max(300),
  })
  .refine((b) => b.repMin !== undefined || b.timeSec !== undefined, {
    message: 'block must specify either a rep range or a time (isometric)',
  })
  .refine((b) => b.repMin === undefined || b.repMax === undefined || b.repMin <= b.repMax, {
    message: 'repMin must be <= repMax',
  })
  .refine((b) => b.targetRirMin <= b.targetRirMax, {
    message: 'targetRirMin must be <= targetRirMax',
  });

export const templateSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  sortOrder: z.number().int(),
  warmupMinutes: z.number().int().min(0).max(30).optional(),
  blocks: z.array(templateBlockSchema).min(1),
});

export const templateCatalogueSchema = z.object({
  version: z.number().int().positive(),
  templates: z.array(templateSchema).min(1),
});

export type TemplateCatalogue = z.infer<typeof templateCatalogueSchema>;
