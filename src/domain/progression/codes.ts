/**
 * Why the second engine decided what it decided (03 §10, §14, §15, §17).
 * Codes, never sentences: the app turns each into Polish through an
 * exhaustive record, and the AI receives them as facts. A code is only
 * returned when it is true — a code that says "lighter" never goes with a
 * resistance that did not change (D39 e).
 *
 * The registry is closed: a rule that wants a new code adds it here, with a
 * line saying what it asserts.
 */

export const DECISION_CODES = [
  // What is known about the last exposure.
  'FIRST_COMPARABLE_EXPOSURE',
  'INTRO_EXPOSURE',
  'INCOMPLETE_PLANNED_SETS',
  'MISSING_SIDE',
  'MISSING_EFFORT_EVIDENCE',
  'UNCONFIRMED_ACTUAL',
  'PRESCRIPTION_DEVIATION',
  'CONTEXT_CONFOUNDED',
  'PAIN_REPORTED',
  'USER_REDUCED',
  // Moving the resistance.
  'LOAD_STEP_UP',
  'LOAD_STEP_DOWN',
  'LOAD_CEILING',
  'AT_MINIMUM',
  'RIR_TOO_LOW',
  'REP_PROGRESSION',
  // Coming back, and the phases.
  'LAYOFF_REPEAT',
  'LAYOFF_STEP_DOWN',
  'RE_EXPOSURE',
  'RECALIBRATION',
  'DELOAD',
  // A step that was tried and failed, and what goes between (12, 03 §8).
  'RUNG_RECENTLY_FAILED',
  // The probe set (03 §15).
  'PROBE_PLANNED',
  'PROBE_PASSED',
  'PROBE_FAILED',
  'PROBE_COOLDOWN',
  'NO_ROOM_FOR_PROBE',
  // The top of what a rep count may be, and the variants (13 §9, D34).
  'REP_CAP_REACHED',
  'VARIANT_UP_SUGGESTED',
  // Building up from the person's own result (03 §17, D39).
  'BUILDUP_BELOW_RANGE',
  'VARIANT_DOWN_SUGGESTED',
  'NO_EASIER_VARIANT',
  // What the person said (03 §14, 13 §12).
  'FEEL_TOO_HARD',
  'FEEL_TOO_EASY',
  'CONFIRM_STEP_UP',
  'USER_DEFERRED',
  // Steps taken during a first exposure (03 §13, D39 c).
  'CALIBRATION_STEP',
  'CALIBRATION_STEP_DOWN',
  // Which variant a slot keeps for the next block (03 §9).
  'ROTATION_CONTINUITY',
  'INSUFFICIENT_ROTATION_EVIDENCE',
  // Nothing can be prescribed.
  'NOT_PRESCRIBED',
  'MODEL_NOT_APPLICABLE',
] as const;

export type DecisionCode = (typeof DECISION_CODES)[number];

/** Codes that say the resistance went to an easier step: true only if it really did (D39 e). */
export const STEP_DOWN_CODES: readonly DecisionCode[] = [
  'LOAD_STEP_DOWN',
  'LAYOFF_STEP_DOWN',
  'CALIBRATION_STEP_DOWN',
];

/** Codes that say the resistance went to a harder step. */
export const STEP_UP_CODES: readonly DecisionCode[] = [
  'LOAD_STEP_UP',
  'PROBE_PASSED',
  'CALIBRATION_STEP',
];
