import { dumbbellLadder } from '../inventory';
import { dumbbellModeOf, loadKindOf } from '../progression/load';
import type { Exercise, KneeProfile } from '../types';
import { isEligible } from './eligibility';
import type { Slot } from './types';

export interface SlotCatalogContext {
  /**
   * The knee the catalogue must still work for: every slot needs at least
   * one candidate this profile allows, or the planner would lose a movement
   * for good.
   */
  knee: KneeProfile;
  bandIds: readonly string[];
}

/**
 * Cross-record invariants of `data/slots.json` that a per-object schema
 * cannot see. Returns human-readable problems; empty means fine. Run by
 * `npm run validate:data` in CI and tested here, so the rules themselves
 * are covered.
 */
export function slotCatalogProblems(
  slots: readonly Slot[],
  exercises: readonly Exercise[],
  ctx: SlotCatalogContext,
): string[] {
  const problems: string[] = [];
  const byId = Object.fromEntries(exercises.map((e) => [e.id, e]));
  const owner = new Map<string, string>();
  const slotIds = new Set<string>();

  for (const slot of slots) {
    if (slotIds.has(slot.id)) problems.push(`duplicate slot id: ${slot.id}`);
    slotIds.add(slot.id);

    for (const id of slot.exerciseIds) {
      const exercise = byId[id];
      if (!exercise) {
        problems.push(`${slot.id}: unknown exercise "${id}"`);
        continue;
      }
      const previous = owner.get(id);
      if (previous !== undefined) {
        problems.push(`${id}: in two slots, ${previous} and ${slot.id}`);
      }
      owner.set(id, slot.id);
      problems.push(...candidateProblems(slot, exercise, ctx));
    }

    if (slot.lightFill && (slot.kind === 'compound' || slot.kind === 'filler')) {
      problems.push(`${slot.id}: light fill is for core and accessory slots`);
    }

    const eligibility = { profile: { knee: ctx.knee }, excludedIds: new Set<string>() };
    const allowed = slot.exerciseIds
      .map((id) => byId[id])
      .filter((e): e is Exercise => e !== undefined && isEligible(e, eligibility));
    if (allowed.length === 0) problems.push(`${slot.id}: no candidate passes the knee filter`);
  }

  for (const exercise of exercises) {
    if (exercise.archived) continue;
    const isCardio = exercise.movementPattern === 'Cardio';
    if (!isCardio && !owner.has(exercise.id)) {
      problems.push(`${exercise.id}: not in any slot`);
    }
    if (isCardio && owner.has(exercise.id)) {
      problems.push(`${exercise.id}: cardio is planned on its own, not in a slot`);
    }
  }

  return problems;
}

function candidateProblems(slot: Slot, exercise: Exercise, ctx: SlotCatalogContext): string[] {
  const out: string[] = [];
  const where = `${slot.id}/${exercise.id}`;

  const isMobility = exercise.movementPattern === 'Mobility';
  if ((slot.kind === 'filler') !== isMobility) {
    out.push(`${where}: filler slots hold mobility work and only they do`);
  }

  if (exercise.forceProfile === 'Isometric') {
    if (!slot.timeRange) out.push(`${where}: isometric, but the slot has no timeRange`);
  } else if (!slot.repRange) {
    out.push(`${where}: counted in reps, but the slot has no repRange`);
  }

  const kind = loadKindOf(exercise);
  if (kind === 'dumbbell') {
    const mode = dumbbellModeOf(exercise);
    const kg = slot.start[mode];
    if (kg === undefined) out.push(`${where}: no start.${mode} weight`);
    else if (!dumbbellLadder(mode).includes(kg)) {
      out.push(`${where}: start.${mode} ${kg} kg is not on the ${mode} ladder`);
    }
  } else if (kind === 'band') {
    const band = slot.start.band;
    if (band === undefined) out.push(`${where}: no start.band`);
    else if (!ctx.bandIds.includes(band)) out.push(`${where}: unknown start band "${band}"`);
  }

  return out;
}
