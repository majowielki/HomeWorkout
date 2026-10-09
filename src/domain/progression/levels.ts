/**
 * Telling steps of a resistance model apart, and building the spec of a step.
 * A model speaks in values; a prescription carries a whole `ResistanceSpec`
 * (model, equipment, configuration), so a step is made by putting the value
 * of a level into the spec of the one it follows.
 */

import { compareSpecs } from '../resistance/compare';
import type {
  ResistanceLevel,
  ResistanceModel,
  ResistanceSpec,
  ResistanceValue,
} from '../resistance/types';

/** The step of the model that the spec is at, or null when it is between steps or off the model. */
export function levelOf(
  model: ResistanceModel,
  spec: ResistanceSpec,
): ResistanceLevel<ResistanceValue> | null {
  return model.levels().find((l) => model.compare(l.value, spec.value) === 'equal') ?? null;
}

export function levelIdOf(model: ResistanceModel, spec: ResistanceSpec): string | null {
  return levelOf(model, spec)?.id ?? null;
}

/** The same setup at another step. */
export function withLevel(
  spec: ResistanceSpec,
  level: ResistanceLevel<ResistanceValue>,
): ResistanceSpec {
  return { ...spec, value: level.value };
}

export function nextHarderSpec(
  model: ResistanceModel,
  spec: ResistanceSpec,
): ResistanceSpec | null {
  const next = model.nextHarder(spec.value);
  return next === null ? null : withLevel(spec, next);
}

export function nextEasierSpec(
  model: ResistanceModel,
  spec: ResistanceSpec,
): ResistanceSpec | null {
  const next = model.nextEasier(spec.value);
  return next === null ? null : withLevel(spec, next);
}

/** Whether two specs are the same step of the same setup. */
export function sameStep(model: ResistanceModel, a: ResistanceSpec, b: ResistanceSpec): boolean {
  return compareSpecs(a, b, model) === 'equal';
}
