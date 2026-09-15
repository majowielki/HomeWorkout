import type { SetLogRow } from '@/db/repositories/setLogs';
import { BANDS } from '@/domain/inventory';
import { pl } from '@/strings/pl';

/** One line per set for the history list: "14 kg × 12 · RIR 2", "czarna P2 × 10 · RIR 1", "masa ciała 45 s". */
export function describeSet(row: SetLogRow): string {
  const s = pl.history.set;

  let load: string;
  if (row.weightKg !== null) {
    load = s.kg(row.weightKg);
  } else if (row.bandId !== null) {
    const label = BANDS.find((b) => b.id === row.bandId)?.label ?? row.bandId;
    load = s.band(label, row.anchorPosition ?? 0);
    if (row.estimatedLoadKg !== null) load += ` (≈ ${row.estimatedLoadKg} kg)`;
  } else {
    load = s.bodyweight;
  }

  const effort = row.timeSec !== null ? s.seconds(row.timeSec) : s.reps(row.reps ?? 0);
  const parts = [`${load} ${effort}`];
  if (row.rir !== null) parts.push(s.rir(row.rir));
  return parts.join(' · ');
}
