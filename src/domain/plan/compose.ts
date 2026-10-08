/**
 * A day composed with the coach from the engine's options (ADR 0006).
 *
 * The coach names movements (slots) and may ask for fewer sets; the engine
 * decides everything else. A composition is selected by the same rules as an
 * extra session (`selectCustom`: recovery, soreness, requests, the weekly and
 * daily maxima, the time budget, the block's exercise for each slot) and then
 * built like any day. What the engine could not take is returned as
 * conflicts, so the coach can explain it or try something else.
 */

import type { ComposedItem } from './constraints';
import type { PlannerInput } from './dayPlanner';
import { extraSessionOptions, selectCustom } from './extra';
import type { DaySelection, SkippedSlot } from './types';

export interface Composition {
  /** What the engine will train: the composed movements it could take, at most the sets asked. */
  selection: DaySelection;
  /** Movements asked for and not taken, with the engine's reason. */
  conflicts: SkippedSlot[];
}

export function composeDay(input: PlannerInput, items: readonly ComposedItem[]): Composition {
  const working = new Set(input.slots.filter((s) => s.kind !== 'filler').map((s) => s.id));
  const asked = new Map<string, number>();
  const conflicts: SkippedSlot[] = [];
  for (const item of items) {
    if (!working.has(item.slotId)) {
      conflicts.push({ slotId: item.slotId, exerciseId: null, reason: 'NO_CANDIDATE' });
    } else if (!asked.has(item.slotId)) {
      asked.set(item.slotId, item.sets);
    }
  }
  const selected = selectCustom(input, [...asked.keys()]);
  return {
    selection: {
      ...selected,
      // Never more than the engine gives; fewer when the coach asked for fewer.
      items: selected.items.map((i) => ({ ...i, sets: Math.min(i.sets, asked.get(i.slotId)!) })),
    },
    conflicts: [...conflicts, ...selected.skipped],
  };
}

/** One movement the coach may use on a day: the block's exercise, whether it can be trained, the sets. */
export interface DayOption {
  slotId: string;
  /** The block's exercise for the slot (or the two-legged swap a fatigued day asks for). */
  exerciseId: string | null;
  available: boolean;
  /** Why not, when it is not available. */
  reason: SkippedSlot['reason'] | null;
  /** The sets the engine would give it on its own; a composition may ask for fewer. */
  sets: number;
}

/** Every working slot of the day, each checked on its own, in the catalogue's order. */
export function dayOptions(input: PlannerInput): DayOption[] {
  return extraSessionOptions(input).map((o) => ({
    slotId: o.slotId,
    exerciseId: o.item?.exerciseId ?? input.block.selections[o.slotId] ?? null,
    available: o.item !== null,
    reason: o.item ? null : o.reason,
    sets: o.item?.sets ?? 0,
  }));
}
