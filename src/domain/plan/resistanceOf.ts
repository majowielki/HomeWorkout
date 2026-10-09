/**
 * The resistance of a catalogue exercise in the engine's terms (engine
 * v2, 05 §5-§8). The catalogue still says only what the exercise is done
 * with — dumbbells in a pair or alone, a long band, the body — and the slot
 * says where it starts; this turns that into the model that knows the steps,
 * the spec a first exposure starts at, and the key results are compared by.
 * Equipment the catalogue cannot name this way is not guessed at: it has no
 * resistance here, and so no automatic prescription (T51).
 */

import { BAND_CONFIG } from '../config/training';
import { ladderFor } from '../progression/ladder';
import { dumbbellModeOf, loadKindOf } from '../progression/load';
import { resistanceComparisonKey } from '../resistance/compare';
import { specFromLoad } from '../resistance/persistedLoad';
import {
  DEFAULT_MODEL_CONTEXT,
  type ModelContext,
  type ModelRef,
  RESISTANCE_REGISTRY,
} from '../resistance/registry';
import type { ResistanceModel, ResistanceSpec } from '../resistance/types';
import type { Exercise } from '../types';
import type { Slot } from './types';

export function modelRefOf(exercise: Exercise): ModelRef {
  const kind = loadKindOf(exercise);
  if (kind === 'dumbbell') return { id: `dumbbell.${dumbbellModeOf(exercise)}` };
  if (kind === 'band') {
    return { id: 'band.long', parameters: { romCm: BAND_CONFIG.romCm[exercise.movementPattern] } };
  }
  return { id: 'bodyweight', parameters: { variantId: exercise.id } };
}

export interface ExerciseResistance {
  model: ResistanceModel;
  /** Where a never-done exercise begins. */
  start: ResistanceSpec;
  /** The exercise and the setup; the step is not in it, so every step of one setup is one history. */
  comparisonKey: string;
}

export function resistanceOf(
  exercise: Exercise,
  slot: Slot,
  context: ModelContext = DEFAULT_MODEL_CONTEXT,
): ExerciseResistance | null {
  const made = RESISTANCE_REGISTRY.create(modelRefOf(exercise), context);
  if (!made.ok) return null;
  const load = ladderFor(exercise, slot, context.bandCalibrations).start;
  const start = specFromLoad(load, { variantId: exercise.id });
  return {
    model: made.model,
    start,
    comparisonKey: `${exercise.id}|${resistanceComparisonKey(start, made.model)}`,
  };
}

/** A model for any spec the planner has made, for the audit and the compiler; null if the engine has none. */
export function modelFor(
  spec: ResistanceSpec,
  context: ModelContext = DEFAULT_MODEL_CONTEXT,
): ResistanceModel | null {
  const parameters =
    spec.value.kind === 'bodyweight'
      ? { variantId: spec.value.variantId }
      : spec.value.kind === 'band_position'
        ? { romCm: BAND_CONFIG.romCm.Push }
        : {};
  const made = RESISTANCE_REGISTRY.create({ id: spec.modelId, parameters }, context);
  return made.ok ? made.model : null;
}
