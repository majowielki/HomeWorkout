/**
 * Exposures to build progression examples from (engine v2, P3). A paired
 * dumbbell ladder of 2-4-6-8-10 kg, a bodyweight exercise with no step in
 * either direction, and a builder that turns "12, 12, 11 at 4 kg, RIR 2" into
 * the record the normalizer would have made. Not a suite and not counted in coverage.
 */
import { plannedSetId } from '../plan/ids';
import type { PlannedSet } from '../plan/planV2';
import type { ExposureRecord, ExposureSetRecord } from '../observations/exposure';
import type { SetObservation } from '../observations/types';
import { specFromLoad } from '../resistance/legacy';
import { createBodyweightModel, createDumbbellModel } from '../resistance/models';
import type { ResistanceSpec } from '../resistance/types';
import type { ShortfallReason } from '../types';

export const PAIRED = createDumbbellModel('paired');
export const SINGLE = createDumbbellModel('single');
export const BODY = createBodyweightModel('crunch');

export const kg = (mass: number): ResistanceSpec =>
  specFromLoad({ kind: 'dumbbell', mode: 'paired', kg: mass });
export const single = (mass: number): ResistanceSpec =>
  specFromLoad({ kind: 'dumbbell', mode: 'single', kg: mass });
export const body: ResistanceSpec = specFromLoad({ kind: 'bodyweight' }, { variantId: 'crunch' });

export interface SetResult {
  /** Reps or seconds. `null`: nothing recorded for the set. */
  amount: number | null;
  /** Reps in reserve; `null`: not given. Default 2. */
  rir?: number | null;
  /** Default: `visible`, the highlighted suggestion confirmed. */
  confirmation?: 'visible' | 'none' | 'edited' | 'read_back';
  /** The resistance it was actually done at (default: the planned one). */
  spec?: ResistanceSpec;
  shortfall?: ShortfallReason | null;
  /** `skipped` for a set with no result; `interrupted` for an attempt with nothing in it. */
  status?: 'performed' | 'interrupted';
  /** Patched onto the planned set (role, resistance, target ...). */
  planned?: Partial<PlannedSet>;
}

export interface ExposureOptions {
  date: string;
  /** The planned resistance. */
  spec: ResistanceSpec;
  /** A bare number is that many reps at RIR 2; `null` is a set with no result. */
  sets: (SetResult | number | null)[];
  /** The range of the plan: default 8-12. A time range is in seconds. */
  range?: { lo: number; hi: number };
  /** Plan the target as a time. */
  seconds?: boolean;
  /** The bottom and the top the plan really carried, when it differs from `range` (extended, built up). */
  planned?: { min?: number; max?: number; target?: number };
  /** Planned RIR (default 2-3); `null`: the plan gave none. */
  targetRir?: { min: number; max: number } | null;
  /** Each logical set is done on both sides. */
  sides?: boolean;
  scope?: ExposureRecord['progressionScope'];
  context?: Partial<ExposureRecord['context']>;
  key?: string;
  exerciseId?: string;
  /** For an exposure the person added to beyond the plan. */
  extra?: SetObservation[];
}

const shown = {
  origin: 'user_confirmed' as const,
  channel: 'touch' as const,
  confirmedAt: '2026-10-09T08:00:00.000Z',
  presentedDefault: true,
  confirmation: 'visible' as const,
};
const edited = {
  origin: 'user_reported' as const,
  channel: 'touch' as const,
  confirmedAt: '2026-10-09T08:00:00.000Z',
  presentedDefault: false,
  confirmation: 'edited' as const,
};

export function observationOf(
  planned: PlannedSet,
  sessionId: string,
  exposureId: string,
  result: SetResult,
): SetObservation {
  const seconds = planned.target.kind === 'duration';
  const mode = result.confirmation ?? 'visible';
  const rirField = mode === 'edited' ? edited : { ...shown, confirmation: mode };
  return {
    id: `obs-${planned.id.replaceAll('/', '-')}`,
    commandId: `cmd-${planned.id.replaceAll('/', '-')}`,
    revision: 1,
    sessionId,
    exposureId,
    plannedSetId: planned.id,
    logicalSetId: planned.logicalSetId,
    side: planned.side === 'bilateral' ? null : planned.side,
    status: result.status ?? 'performed',
    amount: {
      ...shown,
      value: seconds
        ? { kind: 'duration', seconds: result.amount ?? 0 }
        : { kind: 'reps', reps: result.amount ?? 0 },
    },
    resistance: { ...shown, value: result.spec ?? planned.resistance },
    rir: { ...rirField, value: result.rir === undefined ? 2 : result.rir },
    shortfall: result.shortfall ?? null,
    performedAt: `${'2026-10-09'}T08:00:00.000Z`,
    recordedAt: `${'2026-10-09'}T08:00:01.000Z`,
  };
}

/** The record the normalizer would make for this exposure. */
export function exposureOf(options: ExposureOptions): ExposureRecord {
  const sessionId = `s${options.date.replaceAll('-', '')}`;
  const id = `${sessionId}/r1/e1`;
  const range = options.range ?? (options.seconds ? { lo: 20, hi: 60 } : { lo: 8, hi: 12 });
  const sets: ExposureSetRecord[] = [];
  options.sets.forEach((entry, index) => {
    const result: SetResult =
      typeof entry === 'number' ? { amount: entry } : (entry ?? { amount: null });
    const ordinal = index + 1;
    const sides = options.sides ? (['left', 'right'] as const) : ([null] as const);
    for (const side of sides) {
      const min = options.planned?.min ?? range.lo;
      const max = options.planned?.max ?? range.hi;
      const target = options.planned?.target ?? max;
      const planned: PlannedSet = {
        id: plannedSetId({ sessionId, planRevision: 1, exposureKey: 'e1', ordinal, side }),
        logicalSetId: plannedSetId({
          sessionId,
          planRevision: 1,
          exposureKey: 'e1',
          ordinal,
          side: null,
        }),
        comparisonGroupId: `${id}/work`,
        role: 'work',
        side: side ?? 'bilateral',
        ordinal,
        target: options.seconds
          ? { kind: 'duration', minSec: min, targetSec: target, maxSec: max }
          : { kind: 'reps', min, target, max, count: 'total' },
        resistance: options.spec,
        targetRir: options.targetRir === undefined ? { min: 2, max: 3 } : options.targetRir,
        restAfterSec: 60,
        requiredForProgression: true,
        ...result.planned,
      };
      const performed = result.amount !== null;
      sets.push({
        planned,
        disposition: performed ? (result.status ?? 'performed') : 'skipped',
        observation: performed ? observationOf(planned, sessionId, id, result) : null,
      });
    }
  });
  return {
    exposureId: id,
    sessionId,
    trainingDate: options.date,
    exerciseId: options.exerciseId ?? 'crunch',
    slotId: 'core',
    comparisonKey: options.key ?? 'crunch|key',
    progressionScope: options.scope ?? 'primary',
    sets,
    extra: options.extra ?? [],
    context: {
      abandoned: false,
      userReduced: false,
      feel: null,
      deload: false,
      ...options.context,
    },
  };
}

/** A date offset from 2026-09-01, for building histories in order. */
export const day = (n: number): string => {
  const d = new Date(Date.UTC(2026, 8, 1 + n));
  return d.toISOString().slice(0, 10);
};
