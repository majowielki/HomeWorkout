import type { z } from 'zod';

import {
  BACKUP_SCHEMA_VERSION,
  backupFileName,
  type BackupFile,
  bandRowSchema,
  bodyMetricRowSchema,
  cardioLogRowSchema,
  dailyLogRowSchema,
  measurementRowSchema,
  setLogRowSchema,
  trainingBlockRowSchema,
  userProfileRowSchema,
  workoutRowSchema,
} from '../format';
import { HISTORICAL_SET_COLUMNS, HISTORICAL_WORKOUT_COLUMNS } from '../../__tests__/rowDefaults';
import { legalObservation, legalPlan } from '@/domain/__tests__/planFixtures';
import { parseBackup } from '../parse';
import type {
  bands,
  bodyMetrics,
  cardioLogs,
  dailyLogs,
  measurements,
  setLogs,
  trainingBlocks,
  userProfile,
  workouts,
} from '../../schema';

/*
 * Compile-time guard: each row schema must produce *exactly* the Drizzle
 * row type, in both directions. `satisfies z.ZodType<Row>` in format.ts
 * only checks that the schema output is assignable to the row — it would
 * not notice a column that exists in the schema but is missing here, so
 * that direction is pinned below. A failing assignment is a type error.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const _profile: Equal<z.infer<typeof userProfileRowSchema>, typeof userProfile.$inferSelect> = true;
const _bands: Equal<z.infer<typeof bandRowSchema>, typeof bands.$inferSelect> = true;
const _workouts: Equal<z.infer<typeof workoutRowSchema>, typeof workouts.$inferSelect> = true;
const _sets: Equal<z.infer<typeof setLogRowSchema>, typeof setLogs.$inferSelect> = true;
const _cardio: Equal<z.infer<typeof cardioLogRowSchema>, typeof cardioLogs.$inferSelect> = true;
const _body: Equal<z.infer<typeof bodyMetricRowSchema>, typeof bodyMetrics.$inferSelect> = true;
const _meas: Equal<z.infer<typeof measurementRowSchema>, typeof measurements.$inferSelect> = true;
const _daily: Equal<z.infer<typeof dailyLogRowSchema>, typeof dailyLogs.$inferSelect> = true;
const _blocks: Equal<
  z.infer<typeof trainingBlockRowSchema>,
  typeof trainingBlocks.$inferSelect
> = true;
void [_profile, _bands, _workouts, _sets, _cardio, _body, _meas, _daily, _blocks];

function validBackup(): BackupFile {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-09-15T08:00:00.000Z',
    app: 'homeworkout',
    tables: {
      user_profile: [
        {
          id: 1,
          heightCm: 180,
          birthYear: 1990,
          sex: 'male',
          dayBoundaryHour: 4,
          saddleHeightCm: null,
          kneeProfile: {
            side: 'right',
            missingCollaterals: true,
            aclReconstructed: true,
            varusThrust: true,
            physioApproved: false,
          },
          reminders: null,
          excludedExerciseIds: null,
          restWeekdays: null,
          updatedAt: '2026-09-15T08:00:00.000Z',
        },
      ],
      bands: [
        {
          id: 'yellow',
          label: 'żółta',
          nominalMinKg: 2,
          nominalMaxKg: 7,
          calibration: null,
          cycleCount: 0,
          calibratedAt: null,
        },
      ],
      workout_templates: [
        {
          id: 'a',
          name: 'A',
          blocks: [
            {
              label: 'A1',
              exerciseId: 'goblet-squat',
              sets: 3,
              repMin: 8,
              repMax: 12,
              targetRirMin: 2,
              targetRirMax: 3,
              restSec: 90,
            },
          ],
          sortOrder: 0,
          warmupMinutes: 5,
          isArchived: false,
        },
      ],
      workouts: [
        {
          id: 'w1',
          trainingDate: '2026-09-14',
          startedAt: '2026-09-14T17:00:00.000Z',
          finishedAt: '2026-09-14T17:40:00.000Z',
          status: 'completed',
          sessionRpe: 7,
          notes: null,
          plan: null,
          ...HISTORICAL_WORKOUT_COLUMNS,
        },
      ],
      set_logs: [
        {
          id: 's1',
          workoutId: 'w1',
          exerciseId: 'goblet-squat',
          exerciseOrder: 0,
          setIndex: 1,
          isWarmup: false,
          reps: 12,
          timeSec: null,
          rir: 2,
          weightKg: 14,
          dumbbellMode: 'single',
          bandId: null,
          anchorPosition: null,
          estimatedLoadKg: null,
          side: null,
          shortfall: null,
          loggedAt: '2026-09-14T17:05:00.000Z',
          ...HISTORICAL_SET_COLUMNS,
        },
      ],
      cardio_logs: [],
      body_metrics: [
        {
          id: 'b1',
          date: '2026-09-15',
          weightKg: 82.5,
          bodyFatPct: null,
          source: 'manual',
          loggedAt: '2026-09-15T06:00:00.000Z',
        },
      ],
      measurements: [],
      daily_logs: [
        {
          date: '2026-09-15',
          sleepHours: 7.5,
          energy: 4,
          stress: 2,
          soreness: { quads: 2 },
          steps: null,
          note: null,
          updatedAt: '2026-09-15T08:00:00.000Z',
        },
      ],
      training_blocks: [
        {
          id: 'b1',
          blockIndex: 1,
          startedOn: '2026-09-14',
          deloadFrom: null,
          deloadReason: null,
          selections: { squat: 'goblet-squat' },
          closedOn: null,
          updatedAt: '2026-09-14T17:00:00.000Z',
        },
      ],
      plan_constraints: [
        {
          id: 'p1',
          kind: 'avoid_muscle',
          muscles: ['quads'],
          fromDate: '2026-09-15',
          untilDate: '2026-09-16',
          reason: 'doms',
          source: 'user',
          note: null,
          createdAt: '2026-09-15T08:00:00.000Z',
          revokedAt: null,
          items: null,
        },
      ],
      set_log_revisions: [],
      set_dispositions: [],
      session_plan_revisions: [],
      feel_reports: [],
      preferences: [],
      legacy_sessions: [],
    },
  };
}

/** What an older file lifts to: no rest days in the pattern and no requests. */
function withoutPlanning(doc: BackupFile): BackupFile {
  return {
    ...doc,
    tables: {
      ...doc.tables,
      user_profile: doc.tables.user_profile.map((r) => ({ ...r, restWeekdays: null })),
      plan_constraints: [],
      workout_templates: [],
    },
  };
}

describe('parseBackup', () => {
  it('round-trips a valid document', () => {
    const doc = validBackup();
    const result = parseBackup(JSON.stringify(doc));
    expect(result).toEqual({ ok: true, data: doc });
  });

  it('rejects text that is not JSON', () => {
    expect(parseBackup('{ nope')).toEqual({ ok: false, reason: 'not_json' });
  });

  it('rejects JSON that is not our envelope', () => {
    expect(parseBackup('{"foo": 1}')).toEqual({ ok: false, reason: 'not_a_backup' });
    expect(parseBackup(JSON.stringify({ ...validBackup(), app: 'other' }))).toEqual({
      ok: false,
      reason: 'not_a_backup',
    });
  });

  it('rejects a document from a newer app', () => {
    const doc = { ...validBackup(), schemaVersion: BACKUP_SCHEMA_VERSION + 1 };
    expect(parseBackup(JSON.stringify(doc))).toEqual({ ok: false, reason: 'newer_version' });
  });

  it('rejects a document with a malformed row and names the field', () => {
    const doc = validBackup();
    doc.tables.set_logs[0]!.anchorPosition = 7 as never;
    const result = parseBackup(JSON.stringify(doc));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
    expect(result.detail).toContain('anchorPosition');
  });

  it('rejects a missing table rather than importing a partial dump', () => {
    const doc = validBackup();
    delete (doc.tables as Partial<BackupFile['tables']>).daily_logs;
    const result = parseBackup(JSON.stringify(doc));
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('rejects dangling references between tables and names them', () => {
    const doc = validBackup();
    doc.tables.set_logs[0]!.bandId = 'green';
    doc.tables.cardio_logs.push({
      id: 'c1',
      workoutId: 'w-missing',
      trainingDate: '2026-09-14',
      purpose: 'warmup',
      minutes: 5,
      resistanceLevel: null,
      avgCadence: null,
      avgHr: null,
      rpe: null,
      loggedAt: '2026-09-14T17:00:00.000Z',
    });
    const result = parseBackup(JSON.stringify(doc));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
    expect(result.detail).toContain('set_logs.s1.bandId -> green');
    expect(result.detail).toContain('cardio_logs.c1.workoutId -> w-missing');
  });

  it('lifts a version 1 file: no exclusions, no plans, no blocks', () => {
    const v2 = withoutPlanning(validBackup());
    const v1 = {
      ...v2,
      schemaVersion: 1,
      tables: {
        ...v2.tables,
        user_profile: v2.tables.user_profile.map(({ excludedExerciseIds: _, ...row }) => row),
        workouts: v2.tables.workouts.map(({ plan: _, ...row }) => row),
        training_blocks: undefined,
      },
    };
    expect(parseBackup(JSON.stringify(v1))).toEqual({
      ok: true,
      data: { ...v2, tables: { ...v2.tables, training_blocks: [] } },
    });
  });

  it('lifts a version 2 file: every set two-sided', () => {
    const v4 = withoutPlanning(validBackup());
    const v2 = {
      ...v4,
      schemaVersion: 2,
      tables: {
        ...v4.tables,
        user_profile: v4.tables.user_profile.map(({ restWeekdays: _, ...row }) => row),
        set_logs: v4.tables.set_logs.map(({ side: _, ...row }) => row),
        plan_constraints: undefined,
      },
    };
    expect(parseBackup(JSON.stringify(v2))).toEqual({ ok: true, data: v4 });
  });

  it('lifts a version 3 file: training every day, no requests', () => {
    const v4 = withoutPlanning(validBackup());
    const v3 = {
      ...v4,
      schemaVersion: 3,
      tables: {
        ...v4.tables,
        user_profile: v4.tables.user_profile.map(({ restWeekdays: _, ...row }) => row),
        plan_constraints: undefined,
      },
    };
    expect(parseBackup(JSON.stringify(v3))).toEqual({ ok: true, data: v4 });
  });

  it('lifts a version 4 file: no request holds a composed day', () => {
    const v5 = validBackup();
    v5.tables.workout_templates = [];
    const v4 = {
      ...v5,
      schemaVersion: 4,
      tables: {
        ...v5.tables,
        plan_constraints: v5.tables.plan_constraints.map(({ items: _, ...row }) => row),
      },
    };
    expect(parseBackup(JSON.stringify(v4))).toEqual({ ok: true, data: v5 });
  });

  it('keeps the movements of a composed day', () => {
    const doc = validBackup();
    doc.tables.plan_constraints[0] = {
      ...doc.tables.plan_constraints[0]!,
      kind: 'compose_day',
      muscles: [],
      reason: 'other',
      source: 'coach',
      items: [{ slotId: 'push', sets: 1 }],
    };
    expect(parseBackup(JSON.stringify(doc))).toEqual({ ok: true, data: doc });
  });

  it('lifts a version 5 file: no set says why it fell short', () => {
    const v6 = validBackup();
    v6.tables.workout_templates = [];
    const v5 = {
      ...v6,
      schemaVersion: 5,
      tables: {
        ...v6.tables,
        set_logs: v6.tables.set_logs.map(({ shortfall: _, ...row }) => row),
      },
    };
    expect(parseBackup(JSON.stringify(v5))).toEqual({ ok: true, data: v6 });
  });

  it('lifts a version 6 file: every session and set is of historical sessions, with no skips or plan revisions', () => {
    const v7 = validBackup();
    v7.tables.workout_templates = [];
    const v6 = {
      ...v7,
      schemaVersion: 6,
      tables: {
        ...v7.tables,
        workouts: v7.tables.workouts.map(
          ({
            planSchema: _a,
            sessionPlan: _b,
            planRevision: _c,
            revision: _d,
            timeZone: _e,
            ...row
          }) => row,
        ),
        set_logs: v7.tables.set_logs.map(
          ({
            commandId: _a,
            plannedSetId: _b,
            exposureId: _c,
            logicalSetId: _d,
            role: _e,
            comparisonKey: _f,
            progressionScope: _g,
            source: _h,
            performedOn: _i,
            revision: _j,
            deletedAt: _k,
            observation: _l,
            ...row
          }) => row,
        ),
        set_log_revisions: undefined,
        set_dispositions: undefined,
        session_plan_revisions: undefined,
        feel_reports: undefined,
        preferences: undefined,
        legacy_sessions: undefined,
      },
    };
    expect(parseBackup(JSON.stringify(v6))).toEqual({ ok: true, data: v7 });
  });

  it('T53 keeps a session of engine whole: its plan, its results with their provenance, skips, revisions', () => {
    const doc = validBackup();
    const plan = legalPlan();
    doc.tables.workouts[0] = {
      ...doc.tables.workouts[0]!,
      planSchema: 2,
      sessionPlan: plan,
      planRevision: 1,
      revision: 3,
      timeZone: 'Europe/Warsaw',
    };
    const observation = legalObservation();
    doc.tables.set_logs[0] = {
      ...doc.tables.set_logs[0]!,
      commandId: observation.commandId,
      plannedSetId: observation.plannedSetId,
      exposureId: observation.exposureId,
      logicalSetId: observation.logicalSetId,
      role: 'work',
      comparisonKey: plan.exposures[0]!.comparisonKey,
      progressionScope: 'primary',
      source: 'plan',
      performedOn: '2026-09-14',
      revision: 2,
      observation,
    };
    doc.tables.set_log_revisions.push({
      setLogId: 's1',
      revision: 1,
      payload: observation,
      replacedAt: '2026-09-14T17:06:00.000Z',
    });
    doc.tables.set_dispositions.push({
      workoutId: 'w1',
      plannedSetId: 's1/r1/e1/2R',
      status: 'skipped',
      reason: 'user_skipped',
      commandId: 'skip-1',
      at: '2026-09-14T17:10:00.000Z',
    });
    doc.tables.session_plan_revisions.push({
      workoutId: 'w1',
      planRevision: 1,
      plan,
      reason: 'start',
      channel: 'engine',
      overrides: [],
      createdAt: '2026-09-14T17:00:00.000Z',
    });
    doc.tables.feel_reports.push({
      id: 'f1',
      workoutId: 'w1',
      exposureId: null,
      feel: 'too_hard',
      channel: 'voice',
      commandId: 'feel-1',
      at: '2026-09-14T17:20:00.000Z',
    });
    doc.tables.preferences.push({
      id: 1,
      data: { revision: 1 },
      revision: 1,
      updatedAt: '2026-09-14T17:00:00.000Z',
    });
    expect(parseBackup(JSON.stringify(doc))).toEqual({ ok: true, data: doc });
  });

  it('refuses a v2 plan that is not consistent, and a result whose provenance contradicts itself', () => {
    const doc = validBackup();
    doc.tables.workouts[0]!.sessionPlan = { ...legalPlan(), planRevision: 0 } as never;
    expect(parseBackup(JSON.stringify(doc))).toMatchObject({ ok: false, reason: 'invalid' });
    const second = validBackup();
    const bad = legalObservation();
    second.tables.set_logs[0]!.observation = {
      ...bad,
      rir: { ...bad.rir, origin: 'user_reported' },
    };
    expect(parseBackup(JSON.stringify(second))).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('keeps why a set fell short', () => {
    const doc = validBackup();
    doc.tables.set_logs[0] = { ...doc.tables.set_logs[0]!, shortfall: 'short_rest' };
    expect(parseBackup(JSON.stringify(doc))).toEqual({ ok: true, data: doc });
  });

  it('lifts a version 1 file even without the tables it extends', () => {
    const v1 = { ...validBackup(), schemaVersion: 1 };
    const tables: Partial<BackupFile['tables']> = { ...v1.tables };
    delete tables.user_profile;
    delete tables.workouts;
    expect(parseBackup(JSON.stringify({ ...v1, tables }))).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('keeps a stored plan as written, checking only its envelope', () => {
    const doc = validBackup();
    const plan = { version: 1, regions: ['push'], exercises: [], somethingNewer: true };
    doc.tables.workouts[0]!.plan = plan as never;
    expect(parseBackup(JSON.stringify(doc))).toMatchObject({ ok: true });
    doc.tables.workouts[0]!.plan = { version: 2 } as never;
    expect(parseBackup(JSON.stringify(doc))).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('accepts a set log without a workout only when its workout is in the file', () => {
    const doc = validBackup();
    doc.tables.set_logs[0]!.workoutId = 'w2';
    expect(parseBackup(JSON.stringify(doc))).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('backupFileName', () => {
  it('uses the local calendar date', () => {
    expect(backupFileName(new Date(2026, 8, 5, 23, 30))).toBe('homeworkout-backup-2026-09-05.json');
  });
});
