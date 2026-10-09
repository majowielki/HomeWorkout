/**
 * The cards of the volume lever for today (engine, 13 §19, D32): the lever's input made from what the
 * planner itself reads — the history, the block's key lifts, the daily log and the signals of fatigue —
 * so the card and the plan cannot see the person differently.
 */
import { buildHistoryIndex } from '../history';
import { fatigueSignals } from '../autoregulation/signals';
import type { ExposureRecord } from '../observations/exposure';
import { slotByExercise } from '../plan/eligibility';
import { modelFor, resistanceOf } from '../plan/resistanceOf';
import type { BlockState, DailyReadiness, Slot } from '../plan/types';
import { volumeTargets } from '../policy/dayPolicy';
import type { TrainingPreferences } from '../preferences/preferences';
import { assess } from '../progression/assessed';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';
import { DEFAULT_MODEL_CONTEXT, type ModelContext } from '../resistance/registry';
import type { Exercise, MuscleGroup } from '../types';
import { type LeverInput, type VolumeCard, volumeRecommendation } from './lever';

export interface VolumeCardsInput {
  asOf: string;
  catalog: Readonly<Record<string, Exercise>>;
  slots: readonly Slot[];
  /** Null before the first block: there are no key lifts to judge. */
  block: Pick<BlockState, 'selections'> | null;
  records: readonly ExposureRecord[];
  daily: readonly DailyReadiness[];
  preferences: TrainingPreferences;
  models?: ModelContext;
}

export function volumeCardsFor(input: VolumeCardsInput): VolumeCard[] {
  const models = input.models ?? DEFAULT_MODEL_CONTEXT;
  const records = input.records.filter((r) => r.trainingDate <= input.asOf);
  const idx = buildHistoryIndex(records, input.catalog, {
    muscleWeights: input.preferences.muscleWeights,
  });
  const slotOf = slotByExercise(input.slots);
  const signals = fatigueSignals({
    asOf: input.asOf,
    records,
    slotOf,
    daily: input.daily,
    modelOf: (spec) => modelFor(spec, models),
  });
  // The key lifts of a muscle: the block's compound exercises that train it as a main muscle.
  const keyExercises: LeverInput['keyExercises'] = {};
  for (const slot of input.slots) {
    if (slot.kind !== 'compound') continue;
    const id = input.block?.selections[slot.id];
    const exercise = id === undefined ? undefined : input.catalog[id];
    const res = exercise === undefined ? null : resistanceOf(exercise, slot, models);
    if (exercise === undefined || res === null) continue;
    const history = assess(
      (idx.byKey.get(res.comparisonKey) ?? []).filter((r) => r.progressionScope === 'primary'),
      DEFAULT_PROGRESSION_POLICY,
      res.model,
    );
    for (const muscle of exercise.primaryMuscles as MuscleGroup[]) {
      keyExercises[muscle] = [...(keyExercises[muscle] ?? []), { history, model: res.model }];
    }
  }
  return volumeRecommendation({
    asOf: input.asOf,
    idx,
    keyExercises,
    daily: input.daily,
    signals,
    targets: volumeTargets(input.preferences),
  });
}
