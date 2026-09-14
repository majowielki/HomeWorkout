/**
 * Domain vocabulary shared by the rules engine, the database layer and the UI.
 *
 * This module — and everything else under src/domain — must stay free of
 * React, Expo and Drizzle imports. See eslint.config.js for the rule that
 * enforces it, and Documents/SPEC-silnik-regul.md §1.1 for the rationale.
 */

export type MovementPattern =
  | 'Squat'
  | 'Hinge'
  | 'Lunge'
  | 'Push'
  | 'Pull'
  | 'Carry'
  | 'Isolation'
  | 'Core'
  | 'Cardio'
  | 'Mobility';

export type Plane = 'Sagittal' | 'Frontal' | 'Transverse';

export type Stance =
  'Bilateral' | 'UnilateralSupported' | 'UnilateralUnsupported' | 'Seated' | 'Prone' | 'Supine';

export type ForceProfile = 'ConcentricEccentric' | 'Isometric' | 'Plyometric';

export type Equipment = 'dumbbell' | 'band' | 'mat' | 'bike' | 'bodyweight';

export type MuscleGroup =
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'chest'
  | 'back'
  | 'lats'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'core'
  | 'forearms';

/** Which dumbbell ladder an exercise draws on. See inventory.ts. */
export type DumbbellMode = 'paired' | 'single';

/**
 * How well elastic resistance suits an exercise.
 *
 * Bands resist more the further they stretch, which helps on ascending
 * strength curves (squat, press) and fights the lifter on descending ones
 * (rows, pulls) where the band peaks exactly where leverage is worst.
 * See Documents/PLAN.md §5.4.
 */
export type BandSuitability = 'excellent' | 'ok' | 'poor';

export interface Exercise {
  id: string;
  name: string;

  // Biomechanics — drives the medical safety filter.
  movementPattern: MovementPattern;
  planesOfMotion: Plane[];
  isClosedKineticChain: boolean;
  stanceMechanics: Stance;
  forceProfile: ForceProfile;

  /**
   * Whether the knee joint is loaded at all. Gates every knee exclusion:
   * without it, "reject frontal plane" would also reject lateral raises.
   * See Documents/PLAN.md §10.3.
   */
  loadsKnee: boolean;
  provokesValgusVarus: boolean;
  highAnteriorTibialShear: boolean;

  // Programming.
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment[];
  dumbbellMode?: DumbbellMode;
  bandSuitability: BandSuitability;
  substituteIds: string[];

  // Presentation.
  media: string | null;
  cues: string[];
  /** Mandatory for loadsKnee exercises; validated in scripts/validate-data.ts. */
  kneeCue?: string;

  archived?: boolean;
}

export interface KneeProfile {
  side: 'left' | 'right' | 'both';
  missingCollaterals: boolean;
  aclReconstructed: boolean;
  varusThrust: boolean;
  /** Until a physiotherapist signs off, the engine stays bilateral-only. */
  physioApproved: boolean;
}

export interface MedicalProfile {
  knee: KneeProfile | null;
}

export interface BandCalibrationPoint {
  massKg: number;
  lengthCm: number;
}

export interface BandCalibration {
  restLengthCm: number;
  points: BandCalibrationPoint[];
  fit: { type: 'linear' | 'quadratic'; coeffs: number[] } | null;
  /**
   * Highest mass actually measured. The engine never extrapolates past it —
   * the green band (27-45 kg) cannot be calibrated with 18 kg of dumbbells
   * at all, so its fit is null by design. See SPEC-silnik-regul.md §5.5.
   */
  maxMeasuredKg: number | null;
}

export type AnchorPosition = 0 | 1 | 2 | 3;

export type PlannedLoad =
  | { kind: 'dumbbell'; mode: DumbbellMode; kg: number }
  | { kind: 'band'; bandId: string; position: AnchorPosition }
  | { kind: 'bodyweight' };

export interface TemplateBlock {
  /** Superset label, e.g. 'A1'. Blocks sharing a letter alternate. */
  label: string;
  exerciseId: string;
  sets: number;
  repMin?: number;
  repMax?: number;
  timeSec?: number;
  targetRirMin: number;
  targetRirMax: number;
  restSec: number;
}
