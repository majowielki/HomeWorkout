import type { ExerciseRef, MovementLexicon, ResolvedExercise } from '../catalog/resolve';
import type { EquipmentFamily } from '../catalog/attributes';
import type { ExposureRecord } from '../observations/exposure';
import type { DayInputV2 } from '../plan/dayV2';
import type { PlannedExposure, PlannedSet, SessionPlanV2 } from '../plan/planV2';
import type { SetsRecommendation } from '../plan/sets';
import type { DaySelection, ViolationCode } from '../plan/types';
import type { AssessmentCheck, Verdict } from '../policy/hardAdvice';
import type { MuscleGroup } from '../types';

/** Feel options join in P4b.5. */
export type SessionChange =
  | { kind: 'add_exercise'; exercise: ExerciseRef; sets?: number; position?: 'next' | 'end' }
  | { kind: 'add_sets'; exposureId: string; sets: number }
  | { kind: 'swap_remaining'; exposureId: string; exercise: ExerciseRef }
  | { kind: 'reduce_remaining'; exposureId: string; dropSets?: number; easier?: boolean }
  | { kind: 'skip_remaining'; exposureId: string };

/** Plain domain inputs; no database, UI, channel, or network dependency. */
export interface SessionChangeSnapshot extends DayInputV2 {
  historyRevision: number;
  prefsRevision: number;
  lexicon: MovementLexicon;
  tomorrow: DaySelection | null;
}

export interface ActiveSessionState {
  plan: SessionPlanV2;
  /** Current normalized actual/dispositions, including pending and skipped sets. */
  records: readonly ExposureRecord[];
}

export type PatchOp =
  | { kind: 'insertExposure'; exposure: PlannedExposure; position: 'next' | 'end' }
  | { kind: 'appendSets'; exposureId: string; sets: PlannedSet[] }
  | { kind: 'replaceRemaining'; exposureId: string; setIds: string[]; exposure: PlannedExposure }
  | { kind: 'dropSets' | 'skipRemaining'; exposureId: string; setIds: string[] };

export interface SessionPlanPatch {
  patchId: string;
  basePlanRevision: number;
  ops: PatchOp[];
  /** Concrete revision to show and re-assess before transactional acceptance (P4b.4). */
  plan: SessionPlanV2;
}

export interface PrescriptionSummary {
  exerciseId: string;
  sets: number;
  perSet: Pick<PlannedSet, 'resistance' | 'target' | 'targetRir'>[];
  reasons: string[];
}

export interface ChangeEffects {
  musclesToday: Partial<
    Record<MuscleGroup, { done: number; remainingPlanned: number; after: number; dayMax: number }>
  >;
  musclesWeek: Partial<
    Record<
      MuscleGroup,
      { certain: number; uncertain: number; after: number; max: number; min: number }
    >
  >;
  recovery: Partial<
    Record<
      MuscleGroup,
      { lastPrimaryDate: string | null; daysAgo: number | null; soreness: number | null }
    >
  >;
  overlapToday: { exerciseId: string; sharedPrimary: MuscleGroup[]; samePattern: boolean }[];
  time: { remainingBeforeSec: number; remainingAfterSec: number; maxSec: number };
  progressionScope: PlannedExposure['progressionScope'];
  tomorrow: { date: string; changedSlots: string[]; reasons: ViolationCode[] } | null;
}

/** An assessment without further alternatives: the leaf evaluation shared by the ranker. */
export interface SessionChangeEvaluation {
  assessmentId: string;
  basedOn: {
    sessionId: string;
    planRevision: number;
    historyRevision: number;
    prefsRevision: number;
  };
  verdict: Verdict;
  resolved: ResolvedExercise | { kind: 'not_applicable' };
  checks: AssessmentCheck[];
  effects: ChangeEffects;
  recommendation: { sets: SetsRecommendation; position: 'next' | 'end' } | null;
  prescription: PrescriptionSummary | null;
  patch: SessionPlanPatch | null;
}

export type AlternativeChange = Extract<SessionChange, { kind: 'add_exercise' | 'swap_remaining' }>;
export type AlternativeReason =
  | 'same_slot'
  | 'same_family'
  | 'variant_easier'
  | 'variant_harder'
  | 'substitute'
  | 'preference'
  | 'week_min_helped';

export interface RankedAlternative {
  exerciseId: string;
  why: AlternativeReason[];
  verdict: Verdict;
  prescription: PrescriptionSummary;
  patchId: string;
  /** Explicit intent and full leaf assessment for the card and transactional re-assessment. */
  change: AlternativeChange;
  assessment: SessionChangeEvaluation;
}

export interface AssessmentContext {
  snap: SessionChangeSnapshot;
  session: ActiveSessionState;
  /** Preserve the requested count, insertion position or pending exposure when replacing the exercise. */
  change: AlternativeChange;
  maxAlternatives?: number;
  equipmentFamily?: EquipmentFamily;
}

export interface AlternativesTarget {
  exerciseId?: string;
  slotId?: string;
  muscles: readonly MuscleGroup[];
}

export interface ChangeAssessment extends SessionChangeEvaluation {
  alternatives: RankedAlternative[];
}
