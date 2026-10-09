/**
 * A v2 result read as the columns of the first engine (02 §5).
 *
 * Everything that reads sets today — the history screens, the charts, the
 * coach's facts — reads `reps`, `weight_kg`, `band_id` and the rest. A v2 set
 * keeps its truth in the observation (with where each value came from) and
 * *also* fills those columns, so none of those readers has to change. The way
 * across can refuse: a resistance the first engine cannot write down is not
 * written as a dumbbell or as 0 kg. The columns stay empty and the reader
 * sees a set without a load, which is what it is for that reader.
 */

import { loadFromSpec } from '../resistance/legacy';
import type { AnchorPosition, DumbbellMode } from '../types';
import type { SetObservation } from './types';

export interface LegacyColumns {
  reps: number | null;
  timeSec: number | null;
  rir: number | null;
  weightKg: number | null;
  dumbbellMode: DumbbellMode | null;
  bandId: string | null;
  anchorPosition: AnchorPosition | null;
  side: 'left' | 'right' | null;
}

export function legacyColumns(observation: SetObservation): LegacyColumns {
  const quantity = observation.amount.value;
  const spec = observation.resistance.value;
  const load = spec === null ? null : loadFromSpec(spec);
  return {
    reps: quantity?.kind === 'reps' ? quantity.reps : null,
    // The first engine counts whole seconds.
    timeSec: quantity?.kind === 'duration' ? Math.round(quantity.seconds) : null,
    rir: observation.rir.value,
    weightKg: load?.kind === 'dumbbell' ? load.kg : null,
    dumbbellMode: load?.kind === 'dumbbell' ? load.mode : null,
    bandId: load?.kind === 'band' ? load.bandId : null,
    anchorPosition: load?.kind === 'band' ? load.position : null,
    side: observation.side === 'left' || observation.side === 'right' ? observation.side : null,
  };
}
