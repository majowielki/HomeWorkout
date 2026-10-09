/**
 * Whether two results may be compared (03 §2, T49). The setup around a value
 * counts as much as the value: the same number of kilograms on another machine,
 * a cable at another ratio, a band anchored differently or a pair of dumbbells
 * against one are different resistances, and a history that joins them would
 * move a load up or down on evidence that is not about this one.
 */

import type { Comparison, ResistanceModel, ResistanceSpec } from './types';

/** The part of a comparison key that comes from the resistance; the exercise adds its own. */
export function resistanceComparisonKey(spec: ResistanceSpec, model: ResistanceModel): string {
  return [spec.modelId, spec.configurationKey, model.comparisonSignature(spec.value)].join('|');
}

/** Harder, easier or equal — or `incomparable` when the setups differ, whatever the numbers say. */
export function compareSpecs(
  a: ResistanceSpec,
  b: ResistanceSpec,
  model: ResistanceModel,
): Comparison {
  if (a.modelId !== b.modelId || a.configurationKey !== b.configurationKey) return 'incomparable';
  return model.compare(a.value, b.value);
}
