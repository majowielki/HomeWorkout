/**
 * Where a running session stands (engine v2, 04 §6): the sets of the plan in the order they are
 * done, and what became of each.
 *
 * The order is the plan's own — the `perform` steps of its execution — so a superset goes round by
 * round and a one-sided exercise goes left and right as the compiler put them. A set is *settled*
 * once it has a result or was skipped; what is left is `pending`. The screen walks the pending
 * ones; nothing here is stored.
 */
import type { SetDispositionStatus } from '../observations/types';
import type { PlannedExposure, PlannedSet, SessionPlanV2 } from '../plan/planV2';

/** What is known of each planned set: its result, its interruption or its skip. A set left out is pending. */
export type SetStates = ReadonlyMap<string, SetDispositionStatus>;

export interface SessionStep {
  set: PlannedSet;
  exposure: PlannedExposure;
  /** The exposure's place in the plan. */
  exposureIndex: number;
  /** "A1": the superset of the exposure and its number inside it; a lone exercise is "B1". */
  label: string;
  /** Which set of the exposure this is, 1..rounds. */
  round: number;
  rounds: number;
  /** The side of a one-sided set; null for two-sided work. */
  side: 'left' | 'right' | null;
  /** The step's position among its exposure's steps (0-based), and how many there are. */
  stepOfExposure: number;
  stepsInExposure: number;
  state: SetDispositionStatus;
}

/**
 * The exposures that are done together. Two exposures are one superset when one has a set between
 * two sets of the other: that is how rounds look, and no exercise done one after the other has it.
 */
export function groupsOf(plan: Pick<SessionPlanV2, 'exposures' | 'execution'>): number[][] {
  const index = new Map(plan.exposures.flatMap((e, i) => e.sets.map((s) => [s.id, i] as const)));
  const sequence = plan.execution.steps.flatMap((step) =>
    step.kind === 'perform' ? [index.get(step.plannedSetId)!] : [],
  );
  const first = new Map<number, number>();
  const last = new Map<number, number>();
  sequence.forEach((e, at) => {
    if (!first.has(e)) first.set(e, at);
    last.set(e, at);
  });
  const parent = plan.exposures.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  sequence.forEach((e, at) => {
    for (const [other, start] of first) {
      if (other !== e && start < at && at < last.get(other)!) parent[find(e)] = find(other);
    }
  });
  const groups = new Map<number, number[]>();
  plan.exposures.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  return [...groups.values()].sort((a, b) => a[0]! - b[0]!);
}

/** "A1", "A2", "B1": the letter of the group in the plan, the number of the exercise in it. */
export function labelsOf(plan: Pick<SessionPlanV2, 'exposures' | 'execution'>): string[] {
  const labels: string[] = [];
  groupsOf(plan).forEach((members, g) => {
    members.forEach((exposureIndex, n) => {
      labels[exposureIndex] = `${String.fromCharCode(65 + (g % 26))}${n + 1}`;
    });
  });
  return labels;
}

export function buildSessionSteps(
  plan: Pick<SessionPlanV2, 'exposures' | 'execution'>,
  states: SetStates,
): SessionStep[] {
  const home = new Map(
    plan.exposures.flatMap((exposure, exposureIndex) =>
      exposure.sets.map((set) => [set.id, { exposure, exposureIndex, set }] as const),
    ),
  );
  const labels = labelsOf(plan);
  const performed = plan.execution.steps.flatMap((step) =>
    step.kind === 'perform' ? [home.get(step.plannedSetId)!] : [],
  );
  const stepsOf = new Map<number, number>();
  for (const p of performed) stepsOf.set(p.exposureIndex, (stepsOf.get(p.exposureIndex) ?? 0) + 1);
  const seen = new Map<number, number>();
  return performed.map(({ exposure, exposureIndex, set }) => {
    const stepOfExposure = seen.get(exposureIndex) ?? 0;
    seen.set(exposureIndex, stepOfExposure + 1);
    return {
      set,
      exposure,
      exposureIndex,
      label: labels[exposureIndex]!,
      round: set.ordinal,
      rounds: new Set(exposure.sets.map((s) => s.logicalSetId)).size,
      side: set.side === 'left' || set.side === 'right' ? set.side : null,
      stepOfExposure,
      stepsInExposure: stepsOf.get(exposureIndex)!,
      state: states.get(set.id) ?? 'pending',
    };
  });
}

export const isSettled = (step: Pick<SessionStep, 'state'>) => step.state !== 'pending';

/** Index of the first step still to do at or after `from`, or null when nothing is left from there. */
export function nextPendingIndex(steps: readonly SessionStep[], from: number): number | null {
  for (let i = Math.max(0, from); i < steps.length; i += 1) {
    if (!isSettled(steps[i]!)) return i;
  }
  return null;
}

/** The next step still to do from `from`, wrapping round; null when nothing is left. */
export function nextPendingFrom(steps: readonly SessionStep[], from: number): number | null {
  return nextPendingIndex(steps, from) ?? nextPendingIndex(steps, 0);
}

/** Where to resume: the first step still to do, or `steps.length` when the session is done. */
export function findResumeIndex(steps: readonly SessionStep[]): number {
  return nextPendingIndex(steps, 0) ?? steps.length;
}

/** The exposures of the superset an exposure belongs to, in plan order (just itself when alone). */
export function groupExposureIndices(
  plan: Pick<SessionPlanV2, 'exposures' | 'execution'>,
  exposureIndex: number,
): number[] {
  return groupsOf(plan).find((members) => members.includes(exposureIndex)) ?? [exposureIndex];
}

/** True when every set of every exercise of the superset has a result or a skip. */
export function isGroupComplete(steps: readonly SessionStep[], group: readonly number[]): boolean {
  return steps.filter((s) => group.includes(s.exposureIndex)).every(isSettled);
}
