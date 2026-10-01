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
  userProfileRowSchema,
  workoutRowSchema,
  workoutTemplateRowSchema,
} from '../format';
import { parseBackup } from '../parse';
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
const _templates: Equal<
  z.infer<typeof workoutTemplateRowSchema>,
  typeof workoutTemplates.$inferSelect
> = true;
const _workouts: Equal<z.infer<typeof workoutRowSchema>, typeof workouts.$inferSelect> = true;
const _sets: Equal<z.infer<typeof setLogRowSchema>, typeof setLogs.$inferSelect> = true;
const _cardio: Equal<z.infer<typeof cardioLogRowSchema>, typeof cardioLogs.$inferSelect> = true;
const _body: Equal<z.infer<typeof bodyMetricRowSchema>, typeof bodyMetrics.$inferSelect> = true;
const _meas: Equal<z.infer<typeof measurementRowSchema>, typeof measurements.$inferSelect> = true;
const _daily: Equal<z.infer<typeof dailyLogRowSchema>, typeof dailyLogs.$inferSelect> = true;
void [_profile, _bands, _templates, _workouts, _sets, _cardio, _body, _meas, _daily];

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
          templateId: 'a',
          sessionRpe: 7,
          notes: null,
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
          loggedAt: '2026-09-14T17:05:00.000Z',
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
    doc.tables.workouts[0]!.templateId = 'gone';
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
    expect(result.detail).toContain('workouts.w1.templateId -> gone');
    expect(result.detail).toContain('cardio_logs.c1.workoutId -> w-missing');
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
