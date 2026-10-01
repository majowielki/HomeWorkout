import { z } from 'zod';

import { muscleGroupSchema } from '@data/exercises.schema';
import { templateBlockSchema } from '@data/templates.schema';

import type {
  bands,
  bodyMetrics,
  cardioLogs,
  dailyLogs,
  measurements,
  setLogs,
  userProfile,
  workouts,
  workoutTemplates,
} from '../schema';

/**
 * The backup file: one JSON document holding every user-authored table.
 *
 * Exercises are not included — they are reference data, reseeded from the
 * bundle on every start. Rows are written exactly as Drizzle selects them
 * (camelCase keys, JSON columns as objects), so the file is a faithful
 * dump rather than a second data model to keep in sync. Every row schema
 * is pinned to the corresponding `$inferSelect` type: add a column to the
 * schema without adding it here and the build fails. See IMPLEMENTACJA §7.5.
 *
 * Bump BACKUP_SCHEMA_VERSION whenever a row shape changes and add a step
 * to MIGRATIONS in parse.ts that lifts the previous shape to the new one.
 */
export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_APP = 'homeworkout';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const instant = z.string().min(1);
const nullableNumber = z.number().nullable();
const nullableInt = z.number().int().nullable();
const nullableString = z.string().nullable();

const kneeProfileSchema = z.object({
  side: z.enum(['left', 'right', 'both']),
  missingCollaterals: z.boolean(),
  aclReconstructed: z.boolean(),
  varusThrust: z.boolean(),
  physioApproved: z.boolean(),
});

const reminderSettingsSchema = z.object({
  weight: z.object({ enabled: z.boolean(), hour: z.number().int(), minute: z.number().int() }),
  workout: z.object({
    enabled: z.boolean(),
    afterDays: z.number().int(),
    hour: z.number().int(),
    minute: z.number().int(),
  }),
  mutedUntil: nullableString,
});

const bandCalibrationSchema = z.object({
  restLengthCm: z.number(),
  points: z.array(z.object({ massKg: z.number(), lengthCm: z.number() })),
  fit: z.object({ type: z.enum(['linear', 'quadratic']), coeffs: z.array(z.number()) }).nullable(),
  maxMeasuredKg: nullableNumber,
});

export const userProfileRowSchema = z.object({
  id: z.number().int(),
  heightCm: nullableNumber,
  birthYear: nullableInt,
  sex: z.enum(['male', 'female']).nullable(),
  dayBoundaryHour: z.number().int(),
  saddleHeightCm: nullableNumber,
  kneeProfile: kneeProfileSchema.nullable(),
  reminders: reminderSettingsSchema.nullable(),
  updatedAt: instant,
}) satisfies z.ZodType<typeof userProfile.$inferSelect>;

export const bandRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  nominalMinKg: z.number(),
  nominalMaxKg: z.number(),
  calibration: bandCalibrationSchema.nullable(),
  cycleCount: z.number().int(),
  calibratedAt: nullableString,
}) satisfies z.ZodType<typeof bands.$inferSelect>;

export const workoutTemplateRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  blocks: z.array(templateBlockSchema),
  sortOrder: z.number().int(),
  warmupMinutes: nullableInt,
  isArchived: z.boolean(),
}) satisfies z.ZodType<typeof workoutTemplates.$inferSelect>;

export const workoutRowSchema = z.object({
  id: z.string(),
  trainingDate: isoDate,
  startedAt: instant,
  finishedAt: nullableString,
  status: z.enum(['in_progress', 'completed', 'abandoned']),
  templateId: nullableString,
  sessionRpe: nullableInt,
  notes: nullableString,
}) satisfies z.ZodType<typeof workouts.$inferSelect>;

export const setLogRowSchema = z.object({
  id: z.string(),
  workoutId: z.string(),
  exerciseId: z.string(),
  exerciseOrder: z.number().int(),
  setIndex: z.number().int(),
  isWarmup: z.boolean(),
  reps: nullableInt,
  timeSec: nullableInt,
  rir: nullableInt,
  weightKg: nullableNumber,
  dumbbellMode: z.enum(['paired', 'single']).nullable(),
  bandId: nullableString,
  anchorPosition: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  estimatedLoadKg: nullableNumber,
  loggedAt: instant,
}) satisfies z.ZodType<typeof setLogs.$inferSelect>;

export const cardioLogRowSchema = z.object({
  id: z.string(),
  workoutId: nullableString,
  trainingDate: isoDate,
  purpose: z.enum(['warmup', 'cardio']),
  minutes: z.number().int(),
  resistanceLevel: nullableInt,
  avgCadence: nullableInt,
  avgHr: nullableInt,
  rpe: nullableInt,
  loggedAt: instant,
}) satisfies z.ZodType<typeof cardioLogs.$inferSelect>;

export const bodyMetricRowSchema = z.object({
  id: z.string(),
  date: isoDate,
  weightKg: z.number(),
  bodyFatPct: nullableNumber,
  source: z.enum(['manual', 'scale', 'navy']),
  loggedAt: instant,
}) satisfies z.ZodType<typeof bodyMetrics.$inferSelect>;

export const measurementRowSchema = z.object({
  id: z.string(),
  date: isoDate,
  waistCm: nullableNumber,
  hipsCm: nullableNumber,
  chestCm: nullableNumber,
  armCm: nullableNumber,
  thighCm: nullableNumber,
  neckCm: nullableNumber,
  loggedAt: instant,
}) satisfies z.ZodType<typeof measurements.$inferSelect>;

export const dailyLogRowSchema = z.object({
  date: isoDate,
  sleepHours: nullableNumber,
  energy: nullableInt,
  stress: nullableInt,
  soreness: z.partialRecord(muscleGroupSchema, z.number()).nullable(),
  steps: nullableInt,
  note: nullableString,
  updatedAt: instant,
}) satisfies z.ZodType<typeof dailyLogs.$inferSelect>;

export const backupTablesSchema = z.object({
  user_profile: z.array(userProfileRowSchema),
  bands: z.array(bandRowSchema),
  workout_templates: z.array(workoutTemplateRowSchema),
  workouts: z.array(workoutRowSchema),
  set_logs: z.array(setLogRowSchema),
  cardio_logs: z.array(cardioLogRowSchema),
  body_metrics: z.array(bodyMetricRowSchema),
  measurements: z.array(measurementRowSchema),
  daily_logs: z.array(dailyLogRowSchema),
});

export const backupFileSchema = z.object({
  schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
  exportedAt: instant,
  app: z.literal(BACKUP_APP),
  tables: backupTablesSchema,
});

export type BackupTables = z.infer<typeof backupTablesSchema>;
export type BackupFile = z.infer<typeof backupFileSchema>;

/** Only the fields needed to decide whether the document is ours and which version it is. */
export const backupEnvelopeSchema = z.object({
  schemaVersion: z.number().int().positive(),
  app: z.literal(BACKUP_APP),
});

export function backupFileName(exportedAt: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const y = exportedAt.getFullYear();
  const m = pad(exportedAt.getMonth() + 1);
  const d = pad(exportedAt.getDate());
  return `homeworkout-backup-${y}-${m}-${d}.json`;
}
