/** Projects observed results into the columns read by history, charts and coach facts.
 * Unsupported resistance remains null; it is never replaced with an invented load. */

import { loadFromSpec } from '../resistance/persistedLoad';
import type { AnchorPosition, DumbbellMode } from '../types';
import type { SetObservation } from './types';

export interface SetLogColumns {
  reps: number | null;
  timeSec: number | null;
  rir: number | null;
  weightKg: number | null;
  dumbbellMode: DumbbellMode | null;
  bandId: string | null;
  anchorPosition: AnchorPosition | null;
  side: 'left' | 'right' | null;
}

export function setLogColumns(observation: SetObservation): SetLogColumns {
  const quantity = observation.amount.value;
  const spec = observation.resistance.value;
  const load = spec === null ? null : loadFromSpec(spec);
  return {
    reps: quantity?.kind === 'reps' ? quantity.reps : null,
    // Persisted time is expressed in whole seconds.
    timeSec: quantity?.kind === 'duration' ? Math.round(quantity.seconds) : null,
    rir: observation.rir.value,
    weightKg: load?.kind === 'dumbbell' ? load.kg : null,
    dumbbellMode: load?.kind === 'dumbbell' ? load.mode : null,
    bandId: load?.kind === 'band' ? load.bandId : null,
    anchorPosition: load?.kind === 'band' ? load.position : null,
    side: observation.side === 'left' || observation.side === 'right' ? observation.side : null,
  };
}
