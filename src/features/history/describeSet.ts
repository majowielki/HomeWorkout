import type { SetLogRow } from '@/db/repositories/setLogs';
import { BANDS } from '@/domain/inventory';
import { pl } from '@/strings/pl';

/**
 * One line per set for the history list: "14 kg × 12 · RIR 2", "czarna P2
 * (do ≈ 12 kg) × 10 · RIR 1", "masa ciała 45 s"; a one-sided set names its
 * side first: "lewa: masa ciała 30 s"; a reason for falling short comes last:
 * "10 kg × 6 · RIR 1 · krótka przerwa".
 */
export function describeSet(row: SetLogRow): string {
  const s = pl.history.set;

  let load: string;
  if (row.weightKg !== null) {
    load = s.kg(row.weightKg);
  } else if (row.bandId !== null) {
    const label = BANDS.find((b) => b.id === row.bandId)?.label ?? row.bandId;
    load = s.band(label, row.anchorPosition ?? 0);
    if (row.estimatedLoadKg !== null) load += ` ${s.peakKg(row.estimatedLoadKg)}`;
  } else {
    load = s.bodyweight;
  }

  const effort = row.timeSec !== null ? s.seconds(row.timeSec) : s.reps(row.reps ?? 0);
  const parts = [`${row.side ? `${s.side[row.side]}: ` : ''}${load} ${effort}`];
  if (row.rir !== null) parts.push(s.rir(row.rir));
  if (row.shortfall !== null) parts.push(s.shortfall[row.shortfall]);
  return parts.join(' · ');
}
