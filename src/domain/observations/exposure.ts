/**
 * An exposure as the progression reads it: the plan for it set against what
 * was recorded (13 §3, 02 §4). Produced by the normalizer (P3) from plans,
 * results and dispositions; nothing here is stored as it is.
 */

import type { PlannedSet } from '../plan/plan';
import type { IsoDate } from './date';
import type { SetDisposition, SetObservation } from './types';

/** What came of an exposure, worked out from the plan, the dispositions and the results. */
export type ExposureOutcomeStatus = 'complete' | 'partial' | 'skipped' | 'not_started';

export interface ExposureOutcome {
  exposureId: string;
  status: ExposureOutcomeStatus;
  /** The versions it was worked out from, so a stored copy can tell that it is stale. */
  planRevision: number;
  historyRevision: number;
  expected: number;
  performed: number;
  interrupted: number;
  skipped: number;
}

export interface ExposureSetRecord {
  planned: PlannedSet;
  /** `skipped` with reason `session_closed` is worked out when a closed session has nothing for the set. */
  disposition: SetDisposition['status'];
  observation: SetObservation | null;
  /** The set was left out because it hurt: said once, it counts as pain wherever pain is read. */
  skippedForPain?: true;
}

export interface ExposureRecord {
  exposureId: string;
  sessionId: string;
  trainingDate: IsoDate;
  exerciseId: string;
  slotId: string | null;
  comparisonKey: string;
  progressionScope: 'primary' | 'supplemental' | 'none';
  sets: ExposureSetRecord[];
  /** Sets the person added beyond the plan: work for the volume, never evidence for the plan's sets. */
  extra: SetObservation[];
  context: {
    abandoned: boolean;
    /** The person shortened the exposure during the session (D26). */
    userReduced: boolean;
    feel: 'too_hard' | 'too_easy' | null;
    deload: boolean;
  };
}
