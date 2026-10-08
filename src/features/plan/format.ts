import catalogue from '@data/exercises.json';

import { BANDS } from '@/domain/inventory';
import type { PlannedExercise, SessionPlan } from '@/domain/plan/types';
import type { PlannedLoad } from '@/domain/types';
import { pl } from '@/strings/pl';

const MINI_BAND_IDS = new Set(
  catalogue.exercises
    .filter((e) => (e.equipment as string[]).includes('mini-band'))
    .map((e) => e.id),
);

/** "Nogi + pchanie" from the day's regions; a day without hard work is a light day. */
export function planTitle(plan: Pick<SessionPlan, 'regions' | 'kind'>): string {
  const regions = plan.regions.slice(0, 2).map((r) => pl.plan.region[r]);
  if (regions.length === 0) return pl.plan.lightDayTitle;
  const text = regions.join(' + ');
  const title = text.charAt(0).toUpperCase() + text.slice(1);
  return plan.kind === 'extra' ? `${pl.extra.title} · ${title}` : title;
}

export function loadText(load: PlannedLoad, exerciseId?: string): string {
  if (load.kind === 'dumbbell') {
    return load.mode === 'paired' ? pl.plan.load.paired(load.kg) : pl.plan.load.single(load.kg);
  }
  if (load.kind === 'band') {
    const label = BANDS.find((b) => b.id === load.bandId)?.label ?? load.bandId;
    return pl.plan.load.band(label, load.position);
  }
  return exerciseId && MINI_BAND_IDS.has(exerciseId)
    ? pl.plan.load.miniBand
    : pl.plan.load.bodyweight;
}

/** "2 serie · 10 powt. (zakres 10–20) · 2 × 6 kg · RIR 4" */
export function prescriptionText(e: PlannedExercise): string {
  const range: [number, number] | null =
    e.repMin !== undefined && e.repMax !== undefined ? [e.repMin, e.repMax] : null;
  return [
    pl.plan.sets(e.sets),
    pl.plan.amount(e.unit, e.target, range),
    loadText(e.load, e.exerciseId),
    pl.plan.rir(e.targetRirMin, e.targetRirMax),
  ].join(' · ');
}
