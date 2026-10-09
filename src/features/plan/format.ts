import catalogue from '@data/exercises.json';

import { BANDS } from '@/domain/inventory';
import { regionsOf } from '@/domain/plan/day';
import type { PlannedExposure, SessionPlan } from '@/domain/plan/plan';
import type { SlotRegion } from '@/domain/plan/types';
import { loadFromSpec } from '@/domain/resistance/persistedLoad';
import type { ResistanceSpec } from '@/domain/resistance/types';
import { pl } from '@/strings/pl';

import { SLOT_BY_ID } from './slots';

const MINI_BAND_IDS = new Set(
  catalogue.exercises
    .filter((e) => (e.equipment as string[]).includes('mini-band'))
    .map((e) => e.id),
);

/** "Nogi + pchanie" from the day's regions, most sets first; a day without hard work is a light day. */
export function dayTitle(regions: readonly SlotRegion[], kind?: SessionPlan['kind']): string {
  const names = regions.slice(0, 2).map((r) => pl.plan.region[r]);
  if (names.length === 0) return pl.plan.lightDayTitle;
  const text = names.join(' + ');
  const title = text.charAt(0).toUpperCase() + text.slice(1);
  return kind === 'extra' ? `${pl.extra.title} · ${title}` : title;
}

export function planTitle(plan: Pick<SessionPlan, 'exposures' | 'kind'>): string {
  const known = plan.exposures.filter((e) => e.slotId !== null && SLOT_BY_ID.has(e.slotId));
  return dayTitle(regionsOf(known, SLOT_BY_ID), plan.kind);
}

export function loadText(spec: ResistanceSpec, exerciseId?: string): string {
  const load = loadFromSpec(spec);
  if (load?.kind === 'dumbbell') {
    return load.mode === 'paired' ? pl.plan.load.paired(load.kg) : pl.plan.load.single(load.kg);
  }
  if (load?.kind === 'band') {
    const label = BANDS.find((b) => b.id === load.bandId)?.label ?? load.bandId;
    return pl.plan.load.band(label, load.position);
  }
  return exerciseId && MINI_BAND_IDS.has(exerciseId)
    ? pl.plan.load.miniBand
    : pl.plan.load.bodyweight;
}

/** The sets that carry the exposure: the working ones, or all of them when it has none. */
export function workSetsOf(exposure: PlannedExposure) {
  const work = exposure.sets.filter((s) => s.role === 'work' || s.role === 'probe');
  return work.length > 0 ? work : exposure.sets;
}

/** "2 serie · 10 powt. (zakres 10–20) · 2 × 6 kg · RIR 4" */
export function prescriptionText(exposure: PlannedExposure): string {
  const sets = workSetsOf(exposure);
  const first = sets[0]!;
  const target = first.target;
  const amount =
    target.kind === 'reps'
      ? pl.plan.amount('reps', target.target, [target.min, target.max])
      : target.kind === 'duration'
        ? pl.plan.amount('sec', target.targetSec, null)
        : `${target.targetMeters} m`;
  return [
    pl.plan.sets(new Set(sets.map((s) => s.logicalSetId)).size),
    amount,
    loadText(first.resistance, exposure.exercise.id),
    ...(first.targetRir === null ? [] : [pl.plan.rir(first.targetRir.min, first.targetRir.max)]),
  ].join(' · ');
}
