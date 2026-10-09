import type { SetObservation } from '@/domain/observations/types';

/** A result taken back with "Cofnij serię": the set it was for, and what was recorded. */
export interface UndoneSet {
  plannedSetId: string;
  result: SetObservation;
}

/**
 * Hands a set taken back on the summary screen over to the session screen,
 * which the summary replaces. In memory only: the result is already taken
 * back, so after an app restart the session simply resumes at that set, empty.
 */
let pending: { sessionId: string; set: UndoneSet } | null = null;

export function rememberUndone(sessionId: string, set: UndoneSet): void {
  pending = { sessionId, set };
}

/** The set taken back for this session, once. */
export function takeUndone(sessionId: string): UndoneSet | null {
  if (pending?.sessionId !== sessionId) return null;
  const { set } = pending;
  pending = null;
  return set;
}
