/**
 * What goes between "hold" and "step up" while a step is remembered as failed
 * (03 §8, 13 §7): a longer range, or one more set. Both ask for more work at the
 * resistance the person is at, so neither can hurt more than a heavier
 * resistance would; neither needs a model of strength.
 *
 * The order is the one the clearing of a failed step needs (D29): the range is
 * extended first, because reaching its extended top is what clears the step;
 * an extra set clears it only where the range cannot be extended any further.
 */

import type { AmountUnit, ProgressionPolicy } from './policy';

export type Axis = 'extend_range' | 'add_set' | 'hold';

/** The top the range may be extended to: `hi` itself where it may not be. Seconds have no cap of their own. */
export function extendedTop(
  policy: Pick<ProgressionPolicy, 'axes' | 'extendBy'>,
  unit: AmountUnit,
  hi: number,
  repCap: number,
): number {
  if (!policy.axes.extendRange) return hi;
  const wanted = hi + policy.extendBy[unit];
  return Math.max(hi, unit === 'reps' ? Math.min(wanted, repCap) : wanted);
}

export interface AxisInput {
  policy: ProgressionPolicy;
  unit: AmountUnit;
  /** The slot's own top, and the top the last exposure was planned with (it may already be extended). */
  baseHi: number;
  currentHi: number;
  repCap: number;
  /** The sets the policy recommends, and the most the day has room for. */
  recommendedSets: number;
  allowedSets: number;
  /** 2 when the person said it was too easy: the range grows twice as fast. */
  pace?: number;
}

export interface AxisChoice {
  axis: Axis;
  /** The top of the range for the next exposure. */
  hi: number;
  /** The working sets of the next exposure. */
  sets: number;
}

export function chooseIntermediateAxis(input: AxisInput): AxisChoice {
  const { policy, unit } = input;
  const ceiling = extendedTop(policy, unit, input.baseHi, input.repCap);
  const grown = Math.min(ceiling, input.currentHi + policy.step[unit] * (input.pace ?? 1));
  if (grown > input.currentHi) {
    return { axis: 'extend_range', hi: grown, sets: input.recommendedSets };
  }
  if (policy.axes.addSet && input.allowedSets > input.recommendedSets) {
    return { axis: 'add_set', hi: input.currentHi, sets: input.recommendedSets + 1 };
  }
  return { axis: 'hold', hi: input.currentHi, sets: input.recommendedSets };
}
