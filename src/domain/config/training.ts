/**
 * Every tunable number the rules engine uses, in one place — separate from
 * the logic so it can be adjusted against the body's actual response
 * without touching an algorithm. See SPEC-silnik-regul.md §1.3 and
 * PLAN.md §10.1 for why these values are expected to drift.
 */

import type { MovementPattern } from '../types';

export interface BandConfig {
  anchorStepCm: number;
  minCalibrationPoints: number;
  linearR2Threshold: number;
  minLengthStepCm: number;
  recalibrateAfterCycles: number;
  recalibrateAfterDays: number;
  romCm: Record<MovementPattern, number>;
}

export const BAND_CONFIG: BandConfig = {
  /**
   * Spacing between the tape marks on the floor. The app dictates it (like
   * it dictates the four positions) so P2 means the same thing in every
   * session: band start length = rest length + position * step.
   */
  anchorStepCm: 30,

  /** A fit needs at least this many (mass, length) pairs. SPEC §5.5 step 4. */
  minCalibrationPoints: 4,

  /** Linear fit is accepted at or above this R²; otherwise quadratic. SPEC §5.5. */
  linearR2Threshold: 0.97,

  /**
   * When the length gained from one mass to the next drops below this,
   * the band has stopped stretching measurably and the wizard suggests
   * stopping. SPEC §5.5 step 3.
   */
  minLengthStepCm: 1,

  /** Recalibration nudge: whichever comes first. SPEC §5.6 "Zużycie". */
  recalibrateAfterCycles: 5000,
  recalibrateAfterDays: 183,

  /**
   * How much further the band stretches over one concentric, by movement
   * pattern. Rough anthropometric guesses for an adult male — a press or
   * row travels about an arm's length, an isolation move less. They only
   * feed a *range* shown with "≈", never a number with decimals, and the
   * range already spans start-to-end of the rep, so an error here widens
   * or shifts an admittedly fuzzy interval rather than misstating a load.
   */
  romCm: {
    Squat: 40,
    Hinge: 40,
    Lunge: 35,
    Push: 50,
    Pull: 50,
    Carry: 10,
    Isolation: 30,
    Core: 25,
    Cardio: 0,
    Mobility: 20,
  },
};
