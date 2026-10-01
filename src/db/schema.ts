import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { ReminderSettings } from '@/domain/reminders/schedule';
import type {
  AnchorPosition,
  BandCalibration,
  DumbbellMode,
  Exercise,
  KneeProfile,
  MuscleGroup,
  TemplateBlock,
} from '@/domain/types';

/*
 * Conventions:
 *  - ids are UUID text
 *  - *_at columns are ISO-8601 UTC instants
 *  - date / training_date are local calendar days, 'YYYY-MM-DD'
 *  - composite values are JSON columns: with one user and ~60 exercises
 *    there is nothing to gain from normalising them into rows, and the
 *    domain layer filters in memory anyway
 */

export const userProfile = sqliteTable('user_profile', {
  id: integer('id').primaryKey(), // always 1
  heightCm: real('height_cm'),
  birthYear: integer('birth_year'),
  sex: text('sex', { enum: ['male', 'female'] }),
  /** A workout at 00:40 still belongs to the previous training day. */
  dayBoundaryHour: integer('day_boundary_hour').notNull().default(4),
  saddleHeightCm: real('saddle_height_cm'),
  kneeProfile: text('knee_profile', { mode: 'json' }).$type<KneeProfile | null>(),
  /** Null = defaults from domain/reminders/schedule.ts. */
  reminders: text('reminders', { mode: 'json' }).$type<ReminderSettings | null>(),
  updatedAt: text('updated_at').notNull(),
});

export const exercises = sqliteTable('exercises', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  data: text('data', { mode: 'json' }).$type<Exercise>().notNull(),
  /** Bumped in data/exercises.json to push updates without a migration. */
  dataVersion: integer('data_version').notNull(),
});

export const bands = sqliteTable('bands', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  nominalMinKg: real('nominal_min_kg').notNull(),
  nominalMaxKg: real('nominal_max_kg').notNull(),
  calibration: text('calibration', { mode: 'json' }).$type<BandCalibration | null>(),
  /** Drives the re-calibration reminder: elastics soften with use. */
  cycleCount: integer('cycle_count').notNull().default(0),
  calibratedAt: text('calibrated_at'),
});

export const workoutTemplates = sqliteTable('workout_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  blocks: text('blocks', { mode: 'json' }).$type<TemplateBlock[]>().notNull(),
  sortOrder: integer('sort_order').notNull(),
  warmupMinutes: integer('warmup_minutes'),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
});

export const workouts = sqliteTable(
  'workouts',
  {
    id: text('id').primaryKey(),
    trainingDate: text('training_date').notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    status: text('status', {
      enum: ['in_progress', 'completed', 'abandoned'],
    }).notNull(),
    templateId: text('template_id').references(() => workoutTemplates.id),
    sessionRpe: integer('session_rpe'),
    notes: text('notes'),
  },
  (t) => [index('workouts_date_idx').on(t.trainingDate), index('workouts_status_idx').on(t.status)],
);

export const setLogs = sqliteTable(
  'set_logs',
  {
    id: text('id').primaryKey(),
    workoutId: text('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id),
    exerciseOrder: integer('exercise_order').notNull(),
    setIndex: integer('set_index').notNull(),
    /** Warm-up sets are excluded from volume and progression comparisons. */
    isWarmup: integer('is_warmup', { mode: 'boolean' }).notNull().default(false),
    reps: integer('reps'),
    timeSec: integer('time_sec'),
    rir: integer('rir'),
    weightKg: real('weight_kg'),
    dumbbellMode: text('dumbbell_mode', { enum: ['paired', 'single'] }).$type<DumbbellMode>(),
    bandId: text('band_id').references(() => bands.id),
    anchorPosition: integer('anchor_position').$type<AnchorPosition>(),
    /** Null whenever the band has no usable calibration — the normal case
     *  for the green band, not an edge case. */
    estimatedLoadKg: real('estimated_load_kg'),
    loggedAt: text('logged_at').notNull(),
  },
  (t) => [
    index('set_logs_workout_idx').on(t.workoutId),
    index('set_logs_exercise_idx').on(t.exerciseId),
  ],
);

export const cardioLogs = sqliteTable(
  'cardio_logs',
  {
    id: text('id').primaryKey(),
    workoutId: text('workout_id').references(() => workouts.id, { onDelete: 'cascade' }),
    trainingDate: text('training_date').notNull(),
    purpose: text('purpose', { enum: ['warmup', 'cardio'] }).notNull(),
    minutes: integer('minutes').notNull(),
    /** Ordinal on this bike's own dial — not watts, not comparable elsewhere. */
    resistanceLevel: integer('resistance_level'),
    avgCadence: integer('avg_cadence'),
    avgHr: integer('avg_hr'),
    rpe: integer('rpe'),
    loggedAt: text('logged_at').notNull(),
  },
  (t) => [index('cardio_date_idx').on(t.trainingDate)],
);

export const bodyMetrics = sqliteTable(
  'body_metrics',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    weightKg: real('weight_kg').notNull(),
    bodyFatPct: real('body_fat_pct'),
    source: text('source', { enum: ['manual', 'scale', 'navy'] }).notNull(),
    loggedAt: text('logged_at').notNull(),
  },
  (t) => [index('body_date_idx').on(t.date)],
);

export const measurements = sqliteTable('measurements', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  waistCm: real('waist_cm'),
  hipsCm: real('hips_cm'),
  chestCm: real('chest_cm'),
  armCm: real('arm_cm'),
  thighCm: real('thigh_cm'),
  neckCm: real('neck_cm'),
  loggedAt: text('logged_at').notNull(),
});

export const dailyLogs = sqliteTable('daily_logs', {
  date: text('date').primaryKey(),
  sleepHours: real('sleep_hours'),
  energy: integer('energy'),
  stress: integer('stress'),
  soreness: text('soreness', { mode: 'json' }).$type<Partial<Record<MuscleGroup, number>>>(),
  steps: integer('steps'),
  note: text('note'),
  updatedAt: text('updated_at').notNull(),
});
