/**
 * A resistance model for equipment that makes a fixed set of steps, ordered
 * by effort: dumbbells, kettlebells, a barbell with plates, a weight stack, an
 * assisted machine. Each of those only has to say which values exist, how
 * hard each is and what it needs; the comparison, the neighbouring steps and
 * the step size follow from that, the same way for all of them.
 *
 * `effort` is the one place the *direction* lives: it grows with how hard the
 * lifter works. For an assisting machine that is the opposite of the number on
 * the dial, which is exactly why nothing outside a model may assume that a
 * bigger number is harder (05 §7).
 */

import type {
  Comparison,
  ModelCapabilities,
  ResistanceLevel,
  ResistanceModel,
  ResistanceValue,
  ResourceDemand,
  ValidationResult,
} from './types';

export interface LadderDefinition<T extends ResistanceValue> {
  id: string;
  schemaVersion: number;
  capabilities: ModelCapabilities;
  /** Every step, from the easiest to the hardest. Order and uniqueness are checked on creation. */
  levels: readonly ResistanceLevel<T>[];
  validate(value: unknown): ValidationResult<T>;
  /** A number that grows with the effort of the value; compared only between equal signatures. */
  effort(value: T): number;
  signature(value: T): string;
  demand(value: T): ResourceDemand;
  /** Fraction harder `to` is than `from`; the default is the ratio of efforts, `null` when `from` is not above zero. */
  step?(from: T, to: T): number | null;
}

export function createLadderModel<T extends ResistanceValue>(
  def: LadderDefinition<T>,
): ResistanceModel<T> {
  const levels = [...def.levels];
  const ids = new Set(levels.map((l) => l.id));
  if (ids.size !== levels.length) throw new Error(`${def.id}: duplicate level ids`);
  for (let i = 1; i < levels.length; i += 1) {
    if (def.effort(levels[i]!.value) <= def.effort(levels[i - 1]!.value)) {
      throw new Error(`${def.id}: levels must get harder, "${levels[i]!.id}" does not`);
    }
  }

  const compare = (a: T, b: T): Comparison => {
    if (def.signature(a) !== def.signature(b)) return 'incomparable';
    const d = def.effort(a) - def.effort(b);
    return d < 0 ? 'easier' : d > 0 ? 'harder' : 'equal';
  };

  return {
    id: def.id,
    schemaVersion: def.schemaVersion,
    capabilities: def.capabilities,
    validate: def.validate,
    levels: () => levels,
    compare,
    nextHarder: (current) => levels.find((l) => compare(l.value, current) === 'harder') ?? null,
    nextEasier: (current) =>
      [...levels].reverse().find((l) => compare(l.value, current) === 'easier') ?? null,
    resourceDemand: def.demand,
    comparisonSignature: def.signature,
    relativeStep:
      def.step ??
      ((from, to) => {
        const base = def.effort(from);
        return base > 0 ? def.effort(to) / base - 1 : null;
      }),
  };
}
