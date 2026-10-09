/**
 * The graph of variants of one movement (engine v2, 05 §13): push-ups on the
 * knees → push-ups → push-ups with the hands close. It is how a bodyweight
 * exercise progresses once repetitions run out (a harder variant, D34), and
 * how it gets easier when the person cannot reach the bottom of the range
 * (D39). The edges are data; this reads them.
 *
 * An edge is written once, from the exercise it is true for, and the graph
 * adds its inverse: `A harder → B` makes `B easier → A`.
 */

import { type EligibilityContext, isEligible } from '../plan/eligibility';
import type { Exercise } from '../types';

export type VariantDirection = 'harder' | 'easier';

export interface VariantGraph {
  harder: ReadonlyMap<string, readonly string[]>;
  easier: ReadonlyMap<string, readonly string[]>;
}

type WithEdges = Pick<Exercise, 'id' | 'progressions'>;

/**
 * Every neighbour of every exercise, the authored edges first (in the catalogue's order), then their
 * inverses. An exercise is never its own variant, so a self-edge is left out (the data check reports it).
 */
export function buildVariantGraph(exercises: readonly WithEdges[]): VariantGraph {
  const maps = { harder: new Map<string, string[]>(), easier: new Map<string, string[]>() };
  const add = (direction: VariantDirection, from: string, to: string) => {
    const list = maps[direction].get(from) ?? [];
    if (!list.includes(to)) maps[direction].set(from, [...list, to]);
  };
  const edges = exercises.flatMap((e) =>
    (e.progressions ?? [])
      .filter((edge) => edge.to !== e.id)
      .map((edge) => ({ from: e.id, ...edge })),
  );
  for (const edge of edges) add(edge.kind, edge.from, edge.to);
  for (const edge of edges) add(edge.kind === 'harder' ? 'easier' : 'harder', edge.to, edge.from);
  return maps;
}

/**
 * The best neighbour in a direction that the person may actually be given,
 * or null. "May" is the same eligibility every plan goes through — the knee,
 * the "do not suggest" list, equipment — so a variant is never offered that
 * the engine could not have planned. Of the eligible ones the highest
 * `score` wins (a preference, later), then the order of the catalogue.
 */
export function nextVariant(
  id: string,
  direction: VariantDirection,
  graph: VariantGraph,
  catalog: Readonly<Record<string, Exercise>>,
  eligibility: EligibilityContext,
  score: (exercise: Exercise) => number = () => 0,
): Exercise | null {
  const candidates = (graph[direction].get(id) ?? [])
    .map((to, order) => ({ exercise: catalog[to], order }))
    .filter(
      (c): c is { exercise: Exercise; order: number } =>
        c.exercise !== undefined && isEligible(c.exercise, eligibility),
    );
  candidates.sort((a, b) => score(b.exercise) - score(a.exercise) || a.order - b.order);
  return candidates[0]?.exercise ?? null;
}
