import { z } from 'zod';

import { muscleGroupSchema } from '@data/exercises.schema';
import { templateBlockSchema } from '@data/templates.schema';
import { CONSTRAINT_KINDS, CONSTRAINT_REASONS } from '@/domain/plan/constraints';
import { setObservationSchema } from '@/domain/observations/types';
import { sessionPlanSchema } from '@/domain/plan/plan';
import { SLOT_REGIONS, type HistoricalPlan } from '@/domain/plan/types';
import { SHORTFALL_REASONS } from '@/domain/types';

import type {
  bands,
  bodyMetrics,
  cardioLogs,
  dailyLogs,
  feelReports,
  measurements,
  legacySessions,
  planConstraints,
  preferences,
  sessionPlanRevisions,
  setDispositions,
  setLogRevisions,
  setLogs,
  trainingBlocks,
  userProfile,
  workouts,
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
export const BACKUP_SCHEMA_VERSION = 8;
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
  cautiousReps: z.boolean().optional(),
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
  excludedExerciseIds: z.array(z.string()).nullable(),
  restWeekdays: z.array(z.number().int().min(0).max(6)).nullable(),
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
});

/**
 * A plan is the record of what the engine proposed that day (SPEC §10.5),
 * restored as written. Only its envelope is checked: reason codes grow
 * with the engine, and an old plan with a code this build does not know
 * is still history worth keeping.
 */
const historicalPlanEnvelope = z.object({
  regions: z.array(z.enum(SLOT_REGIONS)),
  kind: z.literal('extra').optional(),
  title: z.string().optional(),
});
const sessionPlanRecord = z.custom<HistoricalPlan>(
  (value) => historicalPlanEnvelope.safeParse(value).success,
  'not a historical plan',
);

export const workoutRowSchema = z.object({
  id: z.string(),
  trainingDate: isoDate,
  startedAt: instant,
  finishedAt: nullableString,
  status: z.enum(['in_progress', 'completed', 'abandoned']),
  sessionRpe: nullableInt,
  notes: nullableString,
  plan: sessionPlanRecord.nullable(),
  // Plans before contract 2 remain historical records.
  planSchema: z.union([z.literal(1), z.literal(2)]),
  sessionPlan: sessionPlanSchema.nullable(),
  planRevision: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  timeZone: nullableString,
}) satisfies z.ZodType<typeof workouts.$inferSelect>;

export const trainingBlockRowSchema = z.object({
  id: z.string(),
  blockIndex: z.number().int().positive(),
  startedOn: isoDate,
  deloadFrom: isoDate.nullable(),
  deloadReason: z.enum(['DELOAD_SCHEDULED', 'DELOAD_REACTIVE']).nullable(),
  selections: z.record(z.string(), z.string()),
  closedOn: isoDate.nullable(),
  updatedAt: instant,
}) satisfies z.ZodType<typeof trainingBlocks.$inferSelect>;

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
  side: z.enum(['left', 'right']).nullable(),
  shortfall: z.enum(SHORTFALL_REASONS).nullable(),
  loggedAt: instant,
  // Engine v2 (backup v7).
  commandId: nullableString,
  plannedSetId: nullableString,
  exposureId: nullableString,
  logicalSetId: nullableString,
  role: nullableString,
  comparisonKey: nullableString,
  progressionScope: z.enum(['primary', 'supplemental', 'none']).nullable(),
  source: z.enum(['plan', 'user_override', 'extra']).nullable(),
  performedOn: isoDate.nullable(),
  revision: z.number().int().positive(),
  deletedAt: nullableString,
  observation: setObservationSchema.nullable(),
}) satisfies z.ZodType<typeof setLogs.$inferSelect>;

export const setLogRevisionRowSchema = z.object({
  setLogId: z.string(),
  revision: z.number().int().positive(),
  payload: setObservationSchema.nullable(),
  replacedAt: instant,
}) satisfies z.ZodType<typeof setLogRevisions.$inferSelect>;

export const setDispositionRowSchema = z.object({
  workoutId: z.string(),
  plannedSetId: z.string(),
  status: z.enum(['skipped', 'interrupted']),
  reason: nullableString,
  commandId: z.string(),
  at: instant,
}) satisfies z.ZodType<typeof setDispositions.$inferSelect>;

export const sessionPlanRevisionRowSchema = z.object({
  workoutId: z.string(),
  planRevision: z.number().int().positive(),
  plan: sessionPlanSchema,
  reason: z.enum(['start', 'user_change', 'calibration_step', 'resume']),
  channel: z.enum(['touch', 'voice', 'ai_proposal', 'engine']),
  overrides: z.array(z.string()),
  createdAt: instant,
}) satisfies z.ZodType<typeof sessionPlanRevisions.$inferSelect>;

export const feelReportRowSchema = z.object({
  id: z.string(),
  workoutId: z.string(),
  exposureId: nullableString,
  feel: z.enum(['too_hard', 'too_easy']),
  channel: z.enum(['touch', 'voice', 'ai_proposal']),
  commandId: z.string(),
  at: instant,
}) satisfies z.ZodType<typeof feelReports.$inferSelect>;

export const preferencesRowSchema = z.object({
  id: z.number().int(),
  data: z.unknown(),
  revision: z.number().int().nonnegative(),
  updatedAt: instant,
}) satisfies z.ZodType<typeof preferences.$inferSelect>;

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

export const planConstraintRowSchema = z.object({
  id: z.string(),
  kind: z.enum(CONSTRAINT_KINDS),
  muscles: z.array(muscleGroupSchema),
  fromDate: isoDate,
  untilDate: isoDate,
  reason: z.enum(CONSTRAINT_REASONS),
  source: z.enum(['user', 'coach']),
  note: nullableString,
  createdAt: instant,
  revokedAt: instant.nullable(),
  items: z
    .array(
      z.object({
        slotId: z.string().min(1),
        sets: z.number().int().positive(),
        confirmRecovery: z.boolean().optional(),
      }),
    )
    .nullable(),
}) satisfies z.ZodType<typeof planConstraints.$inferSelect>;

export const legacySessionRowSchema = z.object({
  id: z.string(),
  trainingDate: isoDate,
  startedAt: instant,
  finishedAt: nullableString,
  status: z.string(),
  sessionRpe: nullableInt,
  notes: nullableString,
  plan: z.unknown(),
  sets: z.array(z.unknown()),
  archivedAt: instant,
}) satisfies z.ZodType<typeof legacySessions.$inferSelect>;
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
  training_blocks: z.array(trainingBlockRowSchema),
  plan_constraints: z.array(planConstraintRowSchema),
  set_log_revisions: z.array(setLogRevisionRowSchema),
  set_dispositions: z.array(setDispositionRowSchema),
  session_plan_revisions: z.array(sessionPlanRevisionRowSchema),
  feel_reports: z.array(feelReportRowSchema),
  preferences: z.array(preferencesRowSchema),
  legacy_sessions: z.array(legacySessionRowSchema),
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
