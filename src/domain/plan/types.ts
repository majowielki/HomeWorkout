/**
 * Vocabulary of the daily planner (SPEC-silnik-regul.md §10).
 *
 * A slot names a movement — "horizontal push", "hinge", "calves" — not an
 * exercise. Each block (mesocycle) fills every slot with one exercise from
 * its ordered candidate list, and the next block moves on to the next one.
 * That is what keeps the whole body trained over months without the same
 * twelve exercises on repeat.
 */

export type SlotKind = 'compound' | 'accessory' | 'core' | 'filler';

export type SlotRegion = 'lower' | 'push' | 'pull' | 'shoulders' | 'arms' | 'core' | 'mobility';

/** Where a never-done exercise starts. Guesses, not research — SPEC §5.8. */
export interface SlotStart {
  /** Kilograms per hand on the paired ladder. */
  paired?: number;
  /** Kilograms on one bar, single ladder. */
  single?: number;
  /** Band id; the anchor position comes from the config. */
  band?: string;
}

export interface Slot {
  id: string;
  /** Polish, shown in the UI. */
  name: string;
  kind: SlotKind;
  region: SlotRegion;
  /** Candidates in rotation order, easier first. */
  exerciseIds: string[];
  /** Required when a candidate is counted in reps. */
  repRange?: [number, number];
  /** Required when a candidate is isometric (held for seconds). */
  timeRange?: [number, number];
  rir: [number, number];
  restSec: number;
  start: SlotStart;
}
