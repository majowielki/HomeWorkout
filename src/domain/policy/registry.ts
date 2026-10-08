/**
 * Which progression policies exist, and what an exercise needs before the
 * engine may plan it by itself (engine v2, 05 §8, 07 P1.7).
 *
 * An exercise is planned automatically only if everything on the path
 * agrees it can handle it: the catalogue's measure, the resistance model, the
 * policy that moves the prescription on, the runner that steps through the
 * session and the logger that records the result. Missing any one of them,
 * the exercise is not "partly supported": it stays out of the generated plan
 * (it may still be shown, read-only), and the reason says which part is missing.
 */

import type { ResistanceModel, ResistanceValue } from '../resistance/types';
import type { ResistanceRegistry } from '../resistance/registry';

export type QuantityKind = 'reps' | 'duration' | 'distance';

export interface ProgressionPolicyDef {
  id: string;
  version: string;
  /** What it measures progress in. */
  quantityKinds: readonly QuantityKind[];
  /** Which kinds of resistance value it knows how to step. */
  resistanceKinds: readonly ResistanceValue['kind'][];
  /** Whether it needs the effort (reps in reserve) of a set to decide. */
  needsEffort: boolean;
}

/**
 * The policies the engine has. `reps_then_resistance` is the double
 * progression of today: repetitions (or seconds of a hold) up to the top of the range, then a step in
 * the resistance. Others (a machine's assistance, distance and pace) are added with the equipment
 * that needs them.
 */
export const PROGRESSION_POLICIES: Readonly<Record<string, ProgressionPolicyDef>> = {
  reps_then_resistance: {
    id: 'reps_then_resistance',
    version: '2',
    quantityKinds: ['reps', 'duration'],
    resistanceKinds: ['external_mass', 'band_position', 'bodyweight', 'machine_setting', 'ordinal'],
    needsEffort: true,
  },
};

/** What the session runner can step through. */
export interface RunnerCapabilities {
  quantityKinds: readonly QuantityKind[];
  /** Different resistance in different sets of one exposure (mixed sets, a probe set). */
  perSetResistance: boolean;
}

/** What the set logger can record. */
export interface LoggerCapabilities {
  quantityKinds: readonly QuantityKind[];
  /** The resistance models whose settings the logger has a way to enter. */
  resistanceModels: readonly string[];
  effort: boolean;
}

/** What the app does today; changed together with the runner and the logger, never ahead of them. */
export const CURRENT_RUNNER: RunnerCapabilities = {
  quantityKinds: ['reps', 'duration'],
  perSetResistance: false,
};

export const CURRENT_LOGGER: LoggerCapabilities = {
  quantityKinds: ['reps', 'duration'],
  resistanceModels: ['dumbbell.paired', 'dumbbell.single', 'band.long', 'bodyweight'],
  effort: true,
};

export type MissingCapability =
  | 'UNKNOWN_MODEL'
  | 'UNKNOWN_POLICY'
  | 'MODEL_QUANTITY'
  | 'MODEL_PER_SET_RESISTANCE'
  | 'POLICY_QUANTITY'
  | 'POLICY_RESISTANCE'
  | 'RUNNER_QUANTITY'
  | 'RUNNER_PER_SET_RESISTANCE'
  | 'LOGGER_QUANTITY'
  | 'LOGGER_MODEL'
  | 'LOGGER_EFFORT';

export interface PlanningNeeds {
  /** How the exercise is counted. */
  quantityKind: QuantityKind;
  modelId: string;
  modelParameters?: unknown;
  policyId: string;
  /** The exercise's sets may differ in resistance (a probe set, mixed sets). */
  perSetResistance?: boolean;
}

export type CapabilityCheck = { ok: true } | { ok: false; missing: MissingCapability[] };

/**
 * The intersection of what the exercise, its model, its policy, the runner
 * and the logger can each do (05 §8). `missing` names every part that falls
 * short, so the exercise can be shown with the exact reason it is left out.
 */
export function canPlanAutomatically(
  needs: PlanningNeeds,
  registry: ResistanceRegistry,
  policies: Readonly<Record<string, ProgressionPolicyDef>> = PROGRESSION_POLICIES,
  runner: RunnerCapabilities = CURRENT_RUNNER,
  logger: LoggerCapabilities = CURRENT_LOGGER,
): CapabilityCheck {
  const missing: MissingCapability[] = [];
  const made = registry.create({ id: needs.modelId, parameters: needs.modelParameters });
  const model: ResistanceModel | null = made.ok ? made.model : null;
  const policy = Object.hasOwn(policies, needs.policyId) ? policies[needs.policyId]! : null;
  const kind = needs.quantityKind;

  if (model === null) missing.push('UNKNOWN_MODEL');
  else {
    if (!model.capabilities.quantityKinds.includes(kind)) missing.push('MODEL_QUANTITY');
    if (needs.perSetResistance && !model.capabilities.perSetResistance) {
      missing.push('MODEL_PER_SET_RESISTANCE');
    }
  }

  if (policy === null) {
    missing.push('UNKNOWN_POLICY');
  } else {
    if (!policy.quantityKinds.includes(kind)) missing.push('POLICY_QUANTITY');
    const valueKind = model?.levels()[0]?.value.kind;
    if (valueKind !== undefined && !policy.resistanceKinds.includes(valueKind)) {
      missing.push('POLICY_RESISTANCE');
    }
  }

  if (!runner.quantityKinds.includes(kind)) missing.push('RUNNER_QUANTITY');
  if (needs.perSetResistance && !runner.perSetResistance) {
    missing.push('RUNNER_PER_SET_RESISTANCE');
  }
  if (!logger.quantityKinds.includes(kind)) missing.push('LOGGER_QUANTITY');
  if (!logger.resistanceModels.includes(needs.modelId)) missing.push('LOGGER_MODEL');
  if (policy?.needsEffort && !logger.effort) missing.push('LOGGER_EFFORT');

  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
