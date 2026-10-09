/**
 * The effort of a result as evidence: the reps in reserve the person gave, or
 * nothing when it was a suggestion saved without having been shown (13 §12,
 * D20). A value they typed or said themselves is theirs even if it was not read
 * back.
 */

import type { SetObservation } from './types';

export function effortOf(o: SetObservation): number | null {
  return o.rir.confirmation === 'none' && o.rir.presentedDefault ? null : o.rir.value;
}
