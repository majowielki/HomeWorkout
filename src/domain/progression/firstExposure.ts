/**
 * Settling the start of a new exercise in one session (engine v2, 03 §13,
 * 13 §8, §20; D24, D39 c). The first exposure begins at the start of the slot.
 * If a set comes out far too easy the person is offered the next step for the
 * sets that remain; if it comes out far too hard, an easier one — or an easier
 * variant where there is no easier resistance — instead of three sets below
 * the range and a guess next time. Nothing is changed by itself: the answer is
 * a proposal the person takes with one touch or one word, and not taking it is
 * not a failure.
 */

import { effortOf } from '../observations/effort';
import type { ExposureSetRecord } from '../observations/exposure';
import { amountOf, isPerformed, rangeOf } from '../observations/qualify';
import type { ResistanceModel, ResistanceSpec } from '../resistance/types';
import { nextEasierSpec, nextHarderSpec } from './levels';
import type { ProgressionPolicy } from './policy';

export interface CalibrationRule {
  kind: 'calibration';
  maxSteps: number;
  upIf: { effortAtLeast: number; amountAtLeast: 'target.max' };
  downIf: { effortAtMost: number; amountBelow: 'target.min' };
  maxStepsDown: number;
}

export function calibrationRuleOf(policy: Pick<ProgressionPolicy, 'calibration'>): CalibrationRule {
  const c = policy.calibration;
  return {
    kind: 'calibration',
    maxSteps: c.maxStepsUp,
    upIf: { effortAtLeast: c.upEffortAtLeast, amountAtLeast: 'target.max' },
    downIf: { effortAtMost: c.downEffortAtMost, amountBelow: 'target.min' },
    maxStepsDown: c.maxStepsDown,
  };
}

/** What the person has already accepted in this exposure. */
export interface CalibrationState {
  stepsUp: number;
  stepsDown: number;
}

export type CalibrationProposal =
  | { kind: 'step_up'; to: ResistanceSpec; code: 'CALIBRATION_STEP' }
  | { kind: 'step_down'; to: ResistanceSpec; code: 'CALIBRATION_STEP_DOWN' }
  /** The sets that remain are done as an easier variant, which starts its own history. */
  | { kind: 'swap_remaining'; variantId: string; code: 'VARIANT_DOWN_SUGGESTED' }
  /** Nothing is easier: the sets that remain are aimed at what this one came to. */
  | { kind: 'lower_target'; target: number; code: 'BUILDUP_BELOW_RANGE' };

export interface CalibrationInput {
  /** The set just done (not the last of the exposure). */
  set: ExposureSetRecord;
  state: CalibrationState;
  model: ResistanceModel;
  policy: Pick<ProgressionPolicy, 'calibration' | 'minAmount'>;
  /** An easier variant the person may be given, already checked for what could be planned. */
  easierVariant: string | null;
}

export function calibrationProposal(input: CalibrationInput): CalibrationProposal | null {
  const { set, model } = input;
  if (!isPerformed(set)) return null;
  const range = rangeOf(set.planned);
  const effort = effortOf(set.observation);
  const amount = amountOf(set.observation);
  if (range === null || effort === null || amount === null) return null;
  const rule = calibrationRuleOf(input.policy);
  const done = set.observation.resistance.value ?? set.planned.resistance;

  if (
    effort >= rule.upIf.effortAtLeast &&
    amount >= range.hi &&
    input.state.stepsUp < rule.maxSteps
  ) {
    const to = nextHarderSpec(model, done);
    return to === null ? null : { kind: 'step_up', to, code: 'CALIBRATION_STEP' };
  }

  if (
    effort <= rule.downIf.effortAtMost &&
    amount < range.lo &&
    input.state.stepsDown < rule.maxStepsDown
  ) {
    const to = nextEasierSpec(model, done);
    if (to !== null) return { kind: 'step_down', to, code: 'CALIBRATION_STEP_DOWN' };
    if (input.easierVariant !== null) {
      return {
        kind: 'swap_remaining',
        variantId: input.easierVariant,
        code: 'VARIANT_DOWN_SUGGESTED',
      };
    }
    const unit = set.planned.target.kind === 'duration' ? 'duration' : 'reps';
    return {
      kind: 'lower_target',
      target: Math.max(input.policy.minAmount[unit], amount),
      code: 'BUILDUP_BELOW_RANGE',
    };
  }
  return null;
}
