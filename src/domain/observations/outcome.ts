/**
 * What came of an exposure, worked out from its plan, what happened to each
 * set and what was recorded (engine v2, 02 §4). Never stored as the truth:
 * the stored copy (`exposure_outcomes`) is a projection that can be rebuilt
 * from this, and says which revisions it was built from.
 *
 * A session that is closed with sets neither done nor skipped does not leave
 * them "pending": the person ended the session, so they were not done. That
 * is *worked out* here (reason `session_closed`) and never written as a
 * result — closing a session must not invent anything about the sets.
 */

import type { PlannedExposure } from '../plan/planV2';
import type { ExposureOutcome, ExposureOutcomeStatus } from './exposure';
import type { SetDispositionStatus } from './types';

export function outcomeStatus(
  expected: number,
  counts: { performed: number; interrupted: number; skipped: number },
): ExposureOutcomeStatus {
  if (counts.performed === expected) return 'complete';
  if (counts.performed === 0 && counts.interrupted === 0) {
    return counts.skipped === expected
      ? 'skipped'
      : counts.skipped === 0
        ? 'not_started'
        : 'partial';
  }
  return 'partial';
}

/**
 * The outcome of one exposure. `sessionClosed` turns every set still pending
 * into a skipped one, for the count only.
 */
export function exposureOutcome(
  exposure: PlannedExposure,
  states: ReadonlyMap<string, SetDispositionStatus>,
  versions: { planRevision: number; historyRevision: number },
  sessionClosed: boolean,
): ExposureOutcome {
  const counts = { performed: 0, interrupted: 0, skipped: 0 };
  for (const set of exposure.sets) {
    const state = states.get(set.id) ?? 'pending';
    if (state === 'performed') counts.performed += 1;
    else if (state === 'interrupted') counts.interrupted += 1;
    else if (state === 'skipped' || sessionClosed) counts.skipped += 1;
  }
  return {
    exposureId: exposure.id,
    status: outcomeStatus(exposure.sets.length, counts),
    planRevision: versions.planRevision,
    historyRevision: versions.historyRevision,
    expected: exposure.sets.length,
    ...counts,
  };
}
