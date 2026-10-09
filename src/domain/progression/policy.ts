/**
 * The numbers one progression policy decides with, gathered in one object so
 * a test can pass its own and a plan can say which it was made with (13 §5).
 * The policy of today is `reps_then_resistance` v2 (`policy/registry.ts`).
 */

import {
  LAYOFF_FROM_DAYS,
  PROGRESSION_CONFIG,
  PROGRESSION_V2_CONFIG,
  type Tunable,
} from '../config/training';
import { PROGRESSION_POLICIES } from '../policy/registry';

/** What an exercise is counted in. Distance has no policy yet. */
export type AmountUnit = 'reps' | 'duration';

export interface ProgressionPolicy extends Tunable<typeof PROGRESSION_V2_CONFIG> {
  id: string;
  version: string;
  /** The step of a target per unit (1 rep, 5 s) and the least a target may be. */
  step: Record<AmountUnit, number>;
  minAmount: Record<AmountUnit, number>;
  /** The first exposures of an exercise run at `introRir`. */
  introExposures: number;
  introRir: number;
  /** An exercise not done for this long comes back one step lighter (rotation clock, 03 §6). */
  reExposureAfterDays: number;
  /** Sessions at `introRir` after a long layoff (global clock). */
  recalibrationSessions: number;
  layoffFromDays: Tunable<typeof LAYOFF_FROM_DAYS>;
}

const base = PROGRESSION_POLICIES.reps_then_resistance!;

export const DEFAULT_PROGRESSION_POLICY: ProgressionPolicy = {
  ...PROGRESSION_V2_CONFIG,
  id: base.id,
  version: base.version,
  step: { reps: PROGRESSION_CONFIG.repStep, duration: PROGRESSION_CONFIG.timeStepSec },
  minAmount: { reps: 1, duration: 5 },
  introExposures: PROGRESSION_CONFIG.introExposures,
  introRir: PROGRESSION_CONFIG.introRir,
  reExposureAfterDays: PROGRESSION_CONFIG.reExposureAfterDays,
  recalibrationSessions: PROGRESSION_CONFIG.recalibrationSessions,
  layoffFromDays: LAYOFF_FROM_DAYS,
};
