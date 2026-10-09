import { BANDS } from '@/domain/inventory';
import { setLogColumns } from '@/domain/observations/project';
import type { SetObservation } from '@/domain/observations/types';
import type { AnchorPosition, ShortfallReason } from '@/domain/types';
import { pl } from '@/strings/pl';

/** What a line about a set is made of: the columns a set is stored with, apart from where it was. */
export interface DescribedSet {
  reps: number | null;
  timeSec: number | null;
  rir: number | null;
  weightKg: number | null;
  bandId: string | null;
  anchorPosition: AnchorPosition | null;
  estimatedLoadKg: number | null;
  side: 'left' | 'right' | null;
  shortfall: ShortfallReason | null;
}

/**
 * One line per set for the history list: "14 kg × 12 · RIR 2", "czarna P2
 * (do ≈ 12 kg) × 10 · RIR 1", "masa ciała 45 s"; a one-sided set names its
 * side first: "lewa: masa ciała 30 s"; a reason for falling short comes last:
 * "10 kg × 6 · RIR 1 · krótka przerwa".
 */
export function describeSet(set: DescribedSet): string {
  const s = pl.history.set;

  let load: string;
  if (set.weightKg !== null) {
    load = s.kg(set.weightKg);
  } else if (set.bandId !== null) {
    const label = BANDS.find((b) => b.id === set.bandId)?.label ?? set.bandId;
    load = s.band(label, set.anchorPosition ?? 0);
    if (set.estimatedLoadKg !== null) load += ` ${s.peakKg(set.estimatedLoadKg)}`;
  } else {
    load = s.bodyweight;
  }

  const effort = set.timeSec !== null ? s.seconds(set.timeSec) : s.reps(set.reps ?? 0);
  const parts = [`${set.side ? `${s.side[set.side]}: ` : ''}${load} ${effort}`];
  if (set.rir !== null) parts.push(s.rir(set.rir));
  if (set.shortfall !== null) parts.push(s.shortfall[set.shortfall]);
  return parts.join(' · ');
}

/** The same line for a result. */
export function describeResult(result: SetObservation): string {
  return describeSet({
    ...setLogColumns(result),
    estimatedLoadKg: null,
    shortfall: result.shortfall,
  });
}
