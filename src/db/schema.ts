import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { DaySelection, SessionPlan } from '@/domain/plan/types';
import type { StoredDayChange } from '@/domain/plan/weekSync';
import type { ReminderSettings } from '@/domain/reminders/schedule';
import type {
  AnchorPosition,
  BandCalibration,
  DumbbellMode,
  Exercise,
  KneeProfile,
  MuscleGroup,
  Side,
  TemplateBlock,
} from '@/domain/types';
import { DEFAULT_DAY_BOUNDARY_HOUR } from '@/domain/time/trainingDate';

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
  dayBoundaryHour: integer('day_boundary_hour').notNull().default(DEFAULT_DAY_BOUNDARY_HOUR),
  saddleHeightCm: real('saddle_height_cm'),
  kneeProfile: text('knee_profile', { mode: 'json' }).$type<KneeProfile | null>(),
  /** Null = defaults from domain/reminders/schedule.ts. */
  reminders: text('reminders', { mode: 'json' }).$type<ReminderSettings | null>(),
  /** Exercises the person asked never to be offered again (SPEC §10.2). Null = none. */
  excludedExerciseIds: text('excluded_exercise_ids', { mode: 'json' }).$type<string[] | null>(),
  /** Weekdays without training, 0 = Monday … 6 = Sunday (SPEC §11.2). Null = train daily. */
  restWeekdays: text('rest_weekdays', { mode: 'json' }).$type<number[] | null>(),
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
    /**
     * What the rules engine proposed, frozen when the session started
     * (SPEC §10.5). Null for a template session.
     */
    plan: text('plan', { mode: 'json' }).$type<SessionPlan | null>(),
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
    /**
     * The side of a one-sided set (exercise `sides: 'perSet'`): a set on the
     * left and one on the right count as one set for the muscle. Null for
     * two-sided work and for every set logged before sides existed.
     */
    side: text('side', { enum: ['left', 'right'] }).$type<Side>(),
    loggedAt: text('logged_at').notNull(),
  },
  (t) => [
    index('set_logs_workout_idx').on(t.workoutId),
    index('set_logs_exercise_idx').on(t.exerciseId),
  ],
);

/**
 * Blocks (mesocycles), one row each: which exercise every slot uses for
 * the block, and the dates that decide its phase (SPEC §10.2). The open
 * block has no closedOn; past rows are the rotation history.
 */
export const trainingBlocks = sqliteTable(
  'training_blocks',
  {
    id: text('id').primaryKey(),
    blockIndex: integer('block_index').notNull(),
    startedOn: text('started_on').notNull(),
    deloadFrom: text('deload_from'),
    deloadReason: text('deload_reason', { enum: ['DELOAD_SCHEDULED', 'DELOAD_REACTIVE'] }),
    /** slotId -> exerciseId. */
    selections: text('selections', { mode: 'json' }).$type<Record<string, string>>().notNull(),
    closedOn: text('closed_on'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('training_blocks_closed_idx').on(t.closedOn)],
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

/**
 * A local, diagnostic record of every call to the coach Worker, with the
 * full request and answer. It lives only on this phone (AI-INTEGRACJA
 * §4.8): the Worker keeps metadata, never content. It is not part of the
 * backup file; it can be cleared without touching a single training log.
 *
 * `outcome` is the Worker's `validationOutcome` on success and the failure
 * `kind` otherwise. It is a plain string so a new kind never needs a
 * migration.
 */
export const aiExchanges = sqliteTable(
  'ai_exchanges',
  {
    id: text('id').primaryKey(),
    kind: text('kind', {
      enum: ['weekly_summary', 'week_intent', 'day_adjustment', 'chat'],
    }).notNull(),
    requestId: text('request_id').notNull(),
    createdAt: text('created_at').notNull(),
    promptVersion: text('prompt_version'),
    model: text('model'),
    latencyMs: integer('latency_ms'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    attempts: integer('attempts'),
    outcome: text('outcome').notNull(),
    /** Exercises a proposal lost to validatePlan. Unused until plans exist. */
    trimmedCount: integer('trimmed_count'),
    request: text('request', { mode: 'json' }).$type<unknown>(),
    response: text('response', { mode: 'json' }).$type<unknown>(),
    /** Null until the person acts on a proposal. A summary is never "accepted". */
    accepted: integer('accepted', { mode: 'boolean' }),
  },
  (t) => [index('ai_exchanges_created_idx').on(t.createdAt)],
);

/**
 * The week ahead as the engine chose it (SPEC §11): one main row per day,
 * plus separately linked extra sessions. Each row holds the
 * choice (slots, exercises, sets — never loads) and the forecast shown in
 * the calendar. Derived from the logs, so it is not in the backup: after a
 * restore the week is simply planned again.
 */
export const plannedDays = sqliteTable(
  'planned_days',
  {
    date: text('date').notNull(),
    /** 1 = main day, 2+ = an extra session, never overwritten by week sync. */
    seq: integer('seq').notNull().default(1),
    workoutId: text('workout_id').references(() => workouts.id, { onDelete: 'cascade' }),
    /** Null on a rest day. */
    selection: text('selection', { mode: 'json' }).$type<DaySelection | null>(),
    forecast: text('forecast', { mode: 'json' }).$type<SessionPlan | null>(),
    /** planned: still ahead or today; done: trained (or a rest day gone by); missed: planned, not trained. */
    status: text('status', { enum: ['planned', 'done', 'missed'] }).notNull(),
    generationId: text('generation_id').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.seq] })],
);

/** Every time the week was planned again, and what changed — the banner on "Dziś". */
export const planGenerations = sqliteTable(
  'plan_generations',
  {
    id: text('id').primaryKey(),
    createdAt: text('created_at').notNull(),
    trigger: text('trigger', {
      enum: ['horizon', 'missed_day', 'unsafe', 'manual', 'constraint', 'coach'],
    }).notNull(),
    fromDate: text('from_date').notNull(),
    changes: text('changes', { mode: 'json' }).$type<StoredDayChange[]>().notNull(),
    /** When the person closed the banner; null while it shows. */
    seenAt: text('seen_at'),
  },
  (t) => [index('plan_generations_created_idx').on(t.createdAt)],
);

/** What the person (or the coach, with consent) asked the planner to respect, SPEC §11.2. */
export const planConstraints = sqliteTable('plan_constraints', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['avoid_muscle', 'rest_day', 'train_day', 'lighter_day'] }).notNull(),
  muscles: text('muscles', { mode: 'json' }).$type<MuscleGroup[]>().notNull(),
  fromDate: text('from_date').notNull(),
  untilDate: text('until_date').notNull(),
  reason: text('reason', { enum: ['doms', 'pain', 'busy', 'other'] }).notNull(),
  source: text('source', { enum: ['user', 'coach'] }).notNull(),
  note: text('note'),
  createdAt: text('created_at').notNull(),
  /** Taken back early; null while it applies. */
  revokedAt: text('revoked_at'),
});
