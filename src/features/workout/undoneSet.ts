import type { SetLogRow } from '@/db/repositories/setLogs';
import { stepKey } from '@/domain/session/steps';

import type { PrefillData } from './SetLogger';

/** A set taken back with "Cofnij serię": where it belongs and what was logged. */
export interface UndoneSet {
  /** `stepKey(blockIndex, setNumber)` of the set's step. */
  key: string;
  prefill: PrefillData;
}

/** The logged numbers of a set, as the logger's starting values. */
export function undoneFromRow(row: SetLogRow): UndoneSet {
  return {
    key: stepKey(row.exerciseOrder, row.setIndex),
    prefill: {
      reps: row.reps,
      timeSec: row.timeSec,
      rir: row.rir,
      weightKg: row.weightKg,
      bandId: row.bandId,
      anchorPosition: row.anchorPosition,
      shortfall: row.shortfall,
    },
  };
}

/**
 * Hands a set taken back on the summary screen over to the session screen,
 * which the summary replaces. In memory only: the row is already deleted,
 * so after an app restart the session simply resumes at that set, empty.
 */
let pending: { workoutId: string; set: UndoneSet } | null = null;

export function rememberUndone(workoutId: string, set: UndoneSet): void {
  pending = { workoutId, set };
}

/** The set taken back for this workout, once. */
export function takeUndone(workoutId: string): UndoneSet | null {
  if (pending?.workoutId !== workoutId) return null;
  const { set } = pending;
  pending = null;
  return set;
}
