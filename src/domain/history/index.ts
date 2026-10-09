/**
 * The history of exposures, indexed once for everything that plans (engine
 * v2, 13 §13, 02 §7). One pass over the records answers the questions the
 * engine keeps asking: what happened last time with this exercise on this
 * resistance, how much work each muscle got on each day, when a muscle and a
 * slot were last trained.
 *
 * Three different questions are kept apart on purpose. *Progression* reads
 * only the primary exposures of a key. *Volume and recovery* read all work
 * that was actually done, whatever its scope and whether or not the session
 * was finished. The *last comparable* result has no age limit: an exercise
 * that comes back after half a year still has a past.
 */

import { secondaryWeightOf } from '../catalog/attributes';
import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { TRAINING_CONFIG } from '../config/training';
import { compareCodePoints } from '../fingerprint';
import type { ExposureRecord } from '../observations/exposure';
import type { IsoDate } from '../observations/date';
import { effortOf } from '../observations/effort';
import type { Exercise, MuscleGroup } from '../types';
import { countsAsVolume } from '../volume/weekly';

/** The work one muscle got in a day. `certain`: sets known to be hard. `uncertain`: sets whose effort nobody gave. */
export interface MuscleWork {
  certain: number;
  uncertain: number;
  /** The share of sets counted for the muscle as a secondary one, by the weights of the exercises. */
  secondary: number;
}

export interface HistoryIndex {
  /** Primary exposures per comparison key, oldest first: what progression reads. */
  byKey: ReadonlyMap<string, readonly ExposureRecord[]>;
  /** The newest primary exposure of each key, however long ago. */
  lastComparable: ReadonlyMap<string, ExposureRecord>;
  muscleDay: ReadonlyMap<IsoDate, Readonly<Record<MuscleGroup, MuscleWork>>>;
  /** The last day a muscle did any direct work, certain or not. */
  lastPrimary: Readonly<Partial<Record<MuscleGroup, IsoDate>>>;
  /** The last day anything was done in a slot. */
  lastSlot: Readonly<Record<string, IsoDate>>;
}

export interface HistoryIndexOptions {
  config?: Pick<typeof TRAINING_CONFIG, 'workingSetMaxRir' | 'volumeExcludedPatterns'>;
  /** The person's own weights for secondary muscles, by exercise (D35). */
  muscleWeights?: Readonly<Record<string, Partial<Record<MuscleGroup, number>>>>;
  /** The share of a set that counts for a secondary muscle when nobody said (policy). */
  secondaryWeight?: number;
}

/** A set counts for the muscle's day as one set, or half of one when it is one side of a pair (04 §2). */
const share = (side: string) => (side === 'left' || side === 'right' ? 0.5 : 1);

const emptyDay = (): Record<MuscleGroup, MuscleWork> =>
  Object.fromEntries(
    MUSCLE_GROUPS.map((m) => [m, { certain: 0, uncertain: 0, secondary: 0 }]),
  ) as Record<MuscleGroup, MuscleWork>;

export function buildHistoryIndex(
  records: readonly ExposureRecord[],
  catalog: Readonly<Record<string, Exercise>>,
  options: HistoryIndexOptions = {},
): HistoryIndex {
  const cfg = options.config ?? TRAINING_CONFIG;
  const ordered = [...records].sort(
    (a, b) =>
      compareCodePoints(a.trainingDate, b.trainingDate) ||
      compareCodePoints(a.exposureId, b.exposureId),
  );

  const byKey = new Map<string, ExposureRecord[]>();
  const muscleDay = new Map<IsoDate, Record<MuscleGroup, MuscleWork>>();
  const lastPrimary: Partial<Record<MuscleGroup, IsoDate>> = {};
  const lastSlot: Record<string, IsoDate> = {};

  for (const record of ordered) {
    if (record.progressionScope === 'primary') {
      byKey.set(record.comparisonKey, [...(byKey.get(record.comparisonKey) ?? []), record]);
    }
    const exercise = catalog[record.exerciseId];
    const done: { weight: number; effort: number | null; warmup: boolean }[] = [
      ...record.sets.flatMap((s) =>
        s.observation && s.disposition === 'performed'
          ? [
              {
                weight: share(s.planned.side),
                effort: effortOf(s.observation),
                warmup: s.planned.role === 'warmup' || s.planned.role === 'mobility',
              },
            ]
          : [],
      ),
      ...record.extra.flatMap((o) =>
        o.status === 'performed'
          ? [{ weight: share(o.side ?? 'bilateral'), effort: effortOf(o), warmup: false }]
          : [],
      ),
    ];
    const work = done.filter((d) => !d.warmup);
    if (work.length > 0 && record.slotId !== null) lastSlot[record.slotId] = record.trainingDate;
    if (exercise === undefined || !countsAsVolume(exercise, cfg)) continue;

    const day = muscleDay.get(record.trainingDate) ?? emptyDay();
    muscleDay.set(record.trainingDate, day);
    for (const d of work) {
      // A set at RIR 5 or more is practice, not hard work; a set with no effort given may be hard.
      const hard = d.effort !== null && d.effort <= cfg.workingSetMaxRir;
      const unknown = d.effort === null;
      if (!hard && !unknown) continue;
      for (const muscle of exercise.primaryMuscles) {
        if (hard) day[muscle].certain += d.weight;
        else day[muscle].uncertain += d.weight;
        lastPrimary[muscle] = record.trainingDate;
      }
      for (const muscle of exercise.secondaryMuscles) {
        day[muscle].secondary +=
          d.weight *
          secondaryWeightOf(
            exercise,
            muscle,
            options.muscleWeights?.[exercise.id],
            options.secondaryWeight,
          );
      }
    }
  }

  const lastComparable = new Map<string, ExposureRecord>();
  for (const [key, list] of byKey) lastComparable.set(key, list[list.length - 1]!);
  return { byKey, lastComparable, muscleDay, lastPrimary, lastSlot };
}
