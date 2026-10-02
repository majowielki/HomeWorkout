import type { AnchorPosition, DumbbellMode, Exercise, PlannedLoad } from '../types';

export type LoadKind = PlannedLoad['kind'];

/**
 * What an exercise is loaded with. Mirrors the set logger: a band exercise
 * logs a band and a position, anything with a dumbbell logs kilograms (the
 * lightest rung is 2 kg — "dumbbell or bodyweight" exercises are logged
 * with the dumbbell), the rest is bodyweight.
 */
export function loadKindOf(exercise: Pick<Exercise, 'equipment'>): LoadKind {
  if (exercise.equipment.includes('band')) return 'band';
  if (exercise.equipment.includes('dumbbell')) return 'dumbbell';
  return 'bodyweight';
}

/** The ladder a dumbbell exercise moves on; 'paired' unless it says otherwise. */
export function dumbbellModeOf(exercise: Pick<Exercise, 'dumbbellMode'>): DumbbellMode {
  return exercise.dumbbellMode ?? 'paired';
}

/** The load fields of a logged set, whatever layer it comes from. */
export interface LoggedLoad {
  weightKg: number | null;
  dumbbellMode: DumbbellMode | null;
  bandId: string | null;
  anchorPosition: number | null;
}

function clampPosition(position: number | null): AnchorPosition {
  return position === 1 || position === 2 || position === 3 ? position : 0;
}

/**
 * What a logged set carried, as the load kinds the rest of the app uses.
 * A band set always names a band; a dumbbell set always has a weight. The
 * fallbacks cover rows that broke that, rather than throwing on old data.
 */
export function loadOfSet(set: LoggedLoad): PlannedLoad {
  if (set.bandId !== null) {
    return { kind: 'band', bandId: set.bandId, position: clampPosition(set.anchorPosition) };
  }
  if (set.weightKg !== null && set.weightKg > 0) {
    return { kind: 'dumbbell', mode: set.dumbbellMode ?? 'single', kg: set.weightKg };
  }
  return { kind: 'bodyweight' };
}
