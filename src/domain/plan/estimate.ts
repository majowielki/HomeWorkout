import { PLANNER_CONFIG, type PlannerConfig } from '../config/training';
import type { Exercise } from '../types';
import type { PlannedExercise } from './types';

type Timed = Pick<PlannedExercise, 'sets' | 'unit' | 'target' | 'restSec' | 'warmupSet'>;

/**
 * Rough seconds one planned exercise takes: every set's work plus its rest,
 * a changeover, and the band warm-up. One-legged work is done per side, so
 * its work time doubles; an exercise done one side per set has two sets —
 * each with its rest — for every planned one. A tuning parameter, not a
 * stopwatch (SPEC §10.4).
 */
export function exerciseSeconds(
  planned: Timed,
  exercise: Pick<Exercise, 'stanceMechanics' | 'sides'>,
  cfg: PlannerConfig = PLANNER_CONFIG,
): number {
  const perSide = planned.unit === 'sec' ? planned.target : planned.target * cfg.secondsPerRep;
  const perSet = exercise.sides === 'perSet';
  const sides =
    !perSet &&
    (exercise.stanceMechanics === 'UnilateralSupported' ||
      exercise.stanceMechanics === 'UnilateralUnsupported')
      ? 2
      : 1;
  return (
    planned.sets * (perSet ? 2 : 1) * (perSide * sides + planned.restSec) +
    cfg.exerciseChangeoverSec +
    (planned.warmupSet ? cfg.bandWarmupSec : 0)
  );
}

/** Whole minutes for a list of planned exercises, rounded up; unknown exercises count as two-legged. */
export function planMinutes(
  planned: readonly (Timed & { exerciseId: string })[],
  catalog: Readonly<Record<string, Pick<Exercise, 'stanceMechanics' | 'sides'>>>,
  cfg: PlannerConfig = PLANNER_CONFIG,
): number {
  const seconds = planned.reduce(
    (sum, p) =>
      sum + exerciseSeconds(p, catalog[p.exerciseId] ?? { stanceMechanics: 'Bilateral' }, cfg),
    0,
  );
  return Math.ceil(seconds / 60);
}
