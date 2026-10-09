/**
 * Cross-record checks of the catalogue's v2 fields (05 §3, §13, §14), run by
 * `npm run validate:data`. The schema already checks the shape of each entry;
 * these are the things only the whole catalogue can see — an edge to nowhere,
 * a cycle, two exercises sharing an alias.
 *
 * Three levels: an error stops the build; a warning is a gap the data should
 * fill but the engine survives (a core exercise with no easier variant); an
 * info line is a fact worth knowing (an exercise at its ceiling).
 */

import { fold } from '../coach/text';
import { unitOf } from '../progression/prescribe';
import type { Slot } from '../plan/types';
import type { Exercise } from '../types';
import { buildVariantGraph } from './variants';

export interface CatalogueProblems {
  errors: string[];
  warnings: string[];
  info: string[];
}

const LOADED = new Set(['dumbbell', 'band', 'mini-band']);

export function catalogueProblems(
  exercises: readonly Exercise[],
  slots: readonly Slot[],
): CatalogueProblems {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const slotOf = new Map(slots.flatMap((s) => s.exerciseIds.map((id) => [id, s] as const)));

  // ------------------------------------------------------------- variants
  const seen = new Set<string>();
  for (const e of exercises) {
    for (const edge of e.progressions ?? []) {
      const label = `${e.id} ${edge.kind} -> ${edge.to}`;
      const key = `${e.id}>${edge.kind}>${edge.to}`;
      if (seen.has(key)) errors.push(`${label}: written twice`);
      seen.add(key);
      const target = byId.get(edge.to);
      if (target === undefined) {
        errors.push(`${label}: no such exercise`);
        continue;
      }
      if (target.id === e.id) {
        errors.push(`${label}: an exercise cannot be its own variant`);
        continue;
      }
      if (unitOf(e) !== unitOf(target)) {
        errors.push(`${label}: one is counted in ${unitOf(e)}, the other in ${unitOf(target)}`);
      }
      if (!e.primaryMuscles.some((m) => target.primaryMuscles.includes(m))) {
        errors.push(`${label}: no primary muscle in common`);
      }
      const here = slotOf.get(e.id);
      const there = slotOf.get(target.id);
      if (here && there && here.id !== there.id) {
        warnings.push(`${label}: leaves the slot ${here.id} for ${there.id}`);
      }
    }
  }

  const graph = buildVariantGraph(exercises);
  for (const e of exercises) {
    for (const to of graph.harder.get(e.id) ?? []) {
      if (graph.easier.get(e.id)?.includes(to)) {
        errors.push(`${e.id} and ${to}: each is called the harder of the other`);
      }
    }
  }
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      errors.push(
        `harder variants go in a circle: ${[...path.slice(path.indexOf(id)), id].join(' -> ')}`,
      );
      return;
    }
    state.set(id, 'open');
    for (const to of graph.harder.get(id) ?? []) if (byId.has(to)) visit(to, [...path, id]);
    state.set(id, 'done');
  };
  for (const e of exercises) visit(e.id, []);

  for (const e of exercises) {
    if (e.archived) continue;
    const slot = slotOf.get(e.id);
    if (slot?.kind === 'core' && (graph.easier.get(e.id) ?? []).length === 0) {
      warnings.push(`${e.id}: a core exercise with no easier variant (NO_EASIER_VARIANT)`);
    }
    const ceiling =
      !e.equipment.some((q) => LOADED.has(q)) &&
      e.movementPattern !== 'Mobility' &&
      e.movementPattern !== 'Cardio' &&
      (graph.harder.get(e.id) ?? []).length === 0;
    if (ceiling) info.push(`${e.id}: bodyweight with no harder variant (the ceiling)`);
  }

  // -------------------------------------------------------------- aliases
  const owner = new Map<string, string>();
  for (const e of exercises) {
    owner.set(fold(e.name), e.id);
    owner.set(fold(e.id), e.id);
  }
  for (const e of exercises) {
    for (const alias of e.aliases ?? []) {
      const key = fold(alias.trim());
      if (key === '') {
        errors.push(`${e.id}: an empty alias`);
        continue;
      }
      const other = owner.get(key);
      if (other !== undefined && other !== e.id) {
        errors.push(`${e.id}: the alias "${alias}" already means ${other}`);
      }
      owner.set(key, other ?? e.id);
    }
  }

  // --------------------------------------------------------- the rest
  for (const e of exercises) {
    for (const muscle of Object.keys(e.secondaryWeights ?? {})) {
      if (!e.secondaryMuscles.includes(muscle as Exercise['secondaryMuscles'][number])) {
        errors.push(`${e.id}: a weight for ${muscle}, which is not a secondary muscle of it`);
      }
    }
    if (e.equivalenceGroup !== undefined) {
      const slot = slotOf.get(e.id);
      const group = exercises.filter((x) => x.equivalenceGroup === e.equivalenceGroup);
      if (group.length < 2) {
        warnings.push(`${e.id}: the group "${e.equivalenceGroup}" has no other member`);
      } else if (!slot || group.some((x) => slotOf.get(x.id)?.id !== slot.id)) {
        warnings.push(`${e.id}: the group "${e.equivalenceGroup}" spans more than one slot`);
      }
    }
  }

  return { errors, warnings, info };
}
