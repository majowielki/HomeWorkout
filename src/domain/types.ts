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

/** The joints a profile can describe and an exercise can load (05 §12). Only the knee has rules today. */
export const JOINT_IDS = ['knee', 'shoulder', 'lumbar', 'wrist', 'elbow', 'hip', 'ankle'] as const;

export type JointId = (typeof JOINT_IDS)[number];

export type Equipment = 'dumbbell' | 'band' | 'mini-band' | 'mat' | 'bike' | 'bodyweight';

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

export type ExerciseSides = 'perSet' | 'alternating';

/** The side a one-sided set was done on. */
export type Side = 'left' | 'right';

/**
 * Why a set fell short of its target, as the person tells it after the set:
 * sore or tired muscle, too short a rest, technique, pain. Recorded and shown
 * in the history; the engine does not read it (yet).
 */
export const SHORTFALL_REASONS = ['doms', 'short_rest', 'technique', 'pain'] as const;

export type ShortfallReason = (typeof SHORTFALL_REASONS)[number];

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
  /**
   * One-sided work: 'perSet' — a set is one side, the next set the other
   * (side plank); 'alternating' — sides alternate inside every set (bird
   * dog). Absent for two-sided work.
   */
  sides?: ExerciseSides;
  /** Our own Polish steps; they win over the media provider's text where that is wrong. */
  steps?: string[];
  /** The provider's clip shows another exercise or variant: the app shows the photo instead. */
  hideClip?: boolean;

  archived?: boolean;

  // Catalogue flexibility (engine v2, 05 §3, §12-§14). All optional: what is absent is derived or defaulted.
  /** Colloquial and Polish names, so "wyciskanie siedząc" finds its exercise (13 §11). */
  aliases?: string[];
  /** A named group of near-equivalent variants of one slot; the preference breaks ties inside it (12 §4.1). */
  equivalenceGroup?: string;
  /** Analytical family for finding alternatives; never transfers resistance or progression history. */
  comparisonFamily?: string | null;
  /**
   * Directed edges to variants of the same movement (05 §13). Authored in one direction; the graph adds the
   * inverse, so `A harder -> B` also makes `B easier -> A`.
   */
  progressions?: VariantEdge[];
  /** Joints the exercise loads where `loadsKnee` is not enough; `unknown` is not `false` (05 §12). */
  jointLoading?: Partial<Record<JointId, boolean | 'unknown'>>;
  /** How much of a set counts for a secondary muscle, 0-1; absent means the policy default (05 §14). */
  secondaryWeights?: Partial<Record<MuscleGroup, number>>;
}

export interface VariantEdge {
  to: string;
  kind: 'harder' | 'easier';
  note?: string;
  /** The variants are counted differently (seconds against repetitions); the new one starts from its own history. */
  changesMeasure?: true;
}

export interface KneeProfile {
  side: 'left' | 'right' | 'both';
  missingCollaterals: boolean;
  aclReconstructed: boolean;
  varusThrust: boolean;
  /** Until a physiotherapist signs off, the engine stays bilateral-only. */
  physioApproved: boolean;
  /**
   * Keep the repetitions of knee-loading exercises to a cautious ceiling (20, not 25) and off the last
   * rep in reserve (engine v2, D34). On unless set to `false`: the person turns it off in Settings, e.g.
   * with a physiotherapist's word, or never has the profile at all (a healthy knee: no profile, no cap).
   */
  cautiousReps?: boolean;
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

/** Every band's calibration keyed by band id; null for a band that has none yet. */
export type BandCalibrationMap = Record<string, BandCalibration | null>;

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
