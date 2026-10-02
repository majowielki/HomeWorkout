import { MUSCLE_GROUPS } from '@/domain/coach/vocabulary';
import { movingAverage, round1, summarizeWeight, type DatedValue } from '@/domain/metrics/series';
import { volumeStatus, weeklyVolume, type VolumeSet } from '@/domain/volume/weekly';

import type { CoachContext } from '../contract/coachContext';
import type { CoachSource } from './source';

/*
 * Figures the brief and the chat tools both report. They live here, once,
 * so a weekly volume quoted in the summary and the same week asked for in
 * the chat can never be computed two ways. What load a logged set carried
 * is the rules engine's question too, so that one lives in
 * `@/domain/progression/load`.
 */

const byDate = (a: DatedValue, b: DatedValue) => a.date.localeCompare(b.date);

/** Working sets per muscle for the 7 days ending on `endDate`, muscles with none left out. */
export function volumeWeek(
  source: CoachSource,
  endDate: string,
): CoachContext['weeklyVolume'][number] {
  const dateOfWorkout = new Map(source.completedWorkouts.map((w) => [w.id, w.trainingDate]));
  const volumeSets: VolumeSet[] = source.sets.flatMap((s) => {
    const date = dateOfWorkout.get(s.workoutId);
    return s.isWarmup || date === undefined
      ? []
      : [{ exerciseId: s.exerciseId, date, isWarmup: false, rir: s.rir }];
  });
  const volumeExercises = Object.fromEntries(
    source.exercises.map((e) => [
      e.id,
      {
        movementPattern: e.movementPattern,
        primaryMuscles: e.primaryMuscles,
        secondaryMuscles: e.secondaryMuscles,
      },
    ]),
  );
  const totals = weeklyVolume(volumeSets, volumeExercises, endDate);
  return {
    endDate,
    muscles: MUSCLE_GROUPS.filter((m) => totals[m] > 0).map((m) => ({
      muscle: m,
      sets: totals[m],
      status: volumeStatus(totals[m]),
    })),
  };
}

/** Weight and waist over the window that starts on `windowStart` and ends on the source's `asOf`. */
export function bodySummary(
  source: CoachSource,
  windowStart: string,
): { weight: CoachContext['weight']; waist: CoachContext['waist'] } {
  const { asOf } = source;
  const inWindow = (date: string) => date >= windowStart && date <= asOf;

  const weights = source.weights.filter((w) => inWindow(w.date)).sort(byDate);
  const latestWeight = weights[weights.length - 1];
  const smoothed = movingAverage(weights).filter((p) => p.average !== null);
  const weightSummary = summarizeWeight(weights, asOf);
  const weight: CoachContext['weight'] = latestWeight
    ? {
        latestKg: latestWeight.value,
        latestDate: latestWeight.date,
        avg7Kg: weightSummary.average,
        trendKgPerWeek: weightSummary.trend,
        avg7ChangeKg:
          smoothed.length >= 2
            ? round1(smoothed[smoothed.length - 1]!.average! - smoothed[0]!.average!)
            : null,
        entries: weights.length,
      }
    : null;

  const waists = source.waists.filter((w) => inWindow(w.date)).sort(byDate);
  const firstWaist = waists[0];
  const latestWaist = waists[waists.length - 1];
  const waist: CoachContext['waist'] =
    firstWaist && latestWaist
      ? {
          latestCm: latestWaist.value,
          latestDate: latestWaist.date,
          changeCm: waists.length >= 2 ? round1(latestWaist.value - firstWaist.value) : null,
          entries: waists.length,
        }
      : null;

  return { weight, waist };
}
