import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { AUTOREGULATION_CONFIG, type PlannerConfig, TRAINING_CONFIG } from '../config/training';
import { daysBetween } from '../time/trainingDate';
import type { MuscleGroup } from '../types';
import { maxDirectSets } from '../volume/weekly';
import { phaseOf } from './block';
import { avoidedOn, isAvoided, isLighterDay } from './constraints';
import type { DayInput } from './day';
import { isEligible } from './eligibility';
import type { DaySelection, SelectionViolation } from './types';

/** Validates a kept choice against actual work plus an explicitly projected session. */
export function checkSelection(
  selection: DaySelection,
  input: Pick<
    DayInput,
    'asOf' | 'catalog' | 'slots' | 'eligibility' | 'block' | 'daily' | 'constraints'
  >,
  cfg: PlannerConfig,
  training: typeof TRAINING_CONFIG,
  facts: { volume: Record<MuscleGroup, number>; lastPrimary: Partial<Record<MuscleGroup, string>> },
): SelectionViolation[] {
  const { catalog, block, asOf } = input;
  const constraints = input.constraints ?? [];
  const avoided = avoidedOn(constraints, asOf);
  const today = input.daily.find((d) => d.date === asOf);
  const sore = (muscles: MuscleGroup[]) =>
    muscles.some((m) => (today?.soreness?.[m] ?? 0) >= AUTOREGULATION_CONFIG.highSorenessLevel);
  const out: SelectionViolation[] = [];
  if (selection.blockIndex !== block.index || selection.phase !== phaseOf(block, asOf))
    out.push({ slotId: null, code: 'BLOCK_CHANGED' });
  if (isLighterDay(constraints, asOf) !== selection.dayReasons.includes('LIGHTER_DAY_REQUESTED'))
    out.push({ slotId: null, code: 'REQUEST_CHANGED' });
  const added = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>;
  for (const item of selection.items) {
    const exercise = catalog[item.exerciseId];
    const slot = input.slots.find((s) => s.id === item.slotId);
    if (!exercise || !slot || !isEligible(exercise, input.eligibility)) {
      out.push({ slotId: item.slotId, code: 'NOT_ALLOWED' });
      continue;
    }
    if (item.role !== 'mobility' && !item.swapped && block.selections[slot.id] !== exercise.id) {
      out.push({ slotId: item.slotId, code: 'SELECTION_CHANGED' });
      continue;
    }
    const avoidedExercise = isAvoided(exercise, avoided);
    if (item.role === 'work') {
      const recovering = exercise.primaryMuscles.some(
        (m) =>
          facts.lastPrimary[m] !== undefined &&
          daysBetween(facts.lastPrimary[m]!, asOf) <= cfg.recoveryDays,
      );
      const reason = avoidedExercise
        ? 'AVOIDED_BY_REQUEST'
        : sore(exercise.primaryMuscles)
          ? 'DOMS_HIGH'
          : recovering
            ? 'RECOVERING'
            : null;
      if (reason) out.push({ slotId: item.slotId, code: reason });
      for (const m of exercise.primaryMuscles) added[m] += item.sets;
    } else if (avoidedExercise || (item.role === 'light' && sore(exercise.primaryMuscles)))
      out.push({ slotId: item.slotId, code: avoidedExercise ? 'AVOIDED_BY_REQUEST' : 'DOMS_HIGH' });
  }
  for (const m of MUSCLE_GROUPS) {
    if (added[m] === 0) continue;
    if (
      facts.volume[m] + added[m] > maxDirectSets(m, training) ||
      added[m] > cfg.maxDirectSetsPerMuscleDay
    ) {
      out.push({ slotId: null, code: 'VOLUME_AT_MAX' });
      break;
    }
  }
  return out;
}
