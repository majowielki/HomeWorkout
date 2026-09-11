import { z } from 'zod';

/**
 * Single source of truth for the exercise catalogue shape.
 *
 * Used in three places: CI validation (scripts/validate-data.ts), the
 * seeding step at app start, and type inference for the domain layer.
 */

export const muscleGroupSchema = z.enum([
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'chest',
  'back',
  'lats',
  'shoulders',
  'biceps',
  'triceps',
  'core',
  'forearms',
]);

export const exerciseSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/, 'id must be kebab-case: lowercase letters, digits and dashes'),
    name: z.string().min(1),

    movementPattern: z.enum([
      'Squat',
      'Hinge',
      'Lunge',
      'Push',
      'Pull',
      'Carry',
      'Isolation',
      'Core',
    ]),
    planesOfMotion: z.array(z.enum(['Sagittal', 'Frontal', 'Transverse'])).min(1),
    isClosedKineticChain: z.boolean(),
    stanceMechanics: z.enum([
      'Bilateral',
      'UnilateralSupported',
      'UnilateralUnsupported',
      'Seated',
      'Prone',
      'Supine',
    ]),
    forceProfile: z.enum(['ConcentricEccentric', 'Isometric', 'Plyometric']),

    loadsKnee: z.boolean(),
    provokesValgusVarus: z.boolean(),
    highAnteriorTibialShear: z.boolean(),

    primaryMuscles: z.array(muscleGroupSchema).min(1),
    secondaryMuscles: z.array(muscleGroupSchema),
    equipment: z.array(z.enum(['dumbbell', 'band', 'mat', 'bike', 'bodyweight'])).min(1),
    dumbbellMode: z.enum(['paired', 'single']).optional(),
    bandSuitability: z.enum(['excellent', 'ok', 'poor']),
    substituteIds: z.array(z.string()),

    media: z.string().nullable(),
    cues: z.array(z.string()).min(1),
    kneeCue: z.string().optional(),

    archived: z.boolean().optional(),
  })
  .refine((e) => !e.loadsKnee || typeof e.kneeCue === 'string', {
    message: 'every knee-loading exercise must carry a kneeCue',
    path: ['kneeCue'],
  })
  .refine((e) => !e.equipment.includes('dumbbell') || e.dumbbellMode !== undefined, {
    message: 'dumbbell exercises must declare dumbbellMode (paired or single)',
    path: ['dumbbellMode'],
  });

export const exerciseCatalogueSchema = z.object({
  /** Bump to push catalogue changes to an installed app without a migration. */
  version: z.number().int().positive(),
  exercises: z.array(exerciseSchema).min(1),
});

export type ExerciseCatalogue = z.infer<typeof exerciseCatalogueSchema>;
