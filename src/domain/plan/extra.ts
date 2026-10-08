import { PLANNER_CONFIG } from '../config/training';
import { buildDay, type PlannerInput, selectDay } from './dayPlanner';
import { isEligible } from './eligibility';
import type { DaySelection } from './types';

/** Only requested working slots; no automatic light practice or mobility. */
export function selectCustom(input: PlannerInput, slotIds: readonly string[]): DaySelection {
  const slots = input.slots.filter((s) => s.kind !== 'filler' && slotIds.includes(s.id));
  const selections = Object.fromEntries(
    Object.entries(input.block.selections).filter(([, id]) => {
      const e = input.catalog[id];
      return e !== undefined && isEligible(e, input.eligibility);
    }),
  );
  return selectDay(
    { ...input, slots, block: { ...input.block, selections } },
    {
      ...PLANNER_CONFIG,
      // An explicit choice can exceed the weekly target, never the maximum.
      forceStaleDays: 0,
      sessionMinutes: {
        min: 0,
        target: PLANNER_CONFIG.sessionMinutes.max,
        max: PLANNER_CONFIG.sessionMinutes.max,
      },
    },
  );
}

/** A slot's availability independent of the other choices and the session budget. */
export function extraSessionOptions(input: PlannerInput) {
  return input.slots
    .filter((s) => s.kind !== 'filler')
    .map((slot) => {
      const selection = selectCustom(input, [slot.id]);
      return {
        slotId: slot.id,
        item: selection.items[0] ?? null,
        reason: selection.skipped[0]?.reason ?? null,
      };
    });
}

/** Loads from actual logs, ordered and validated exactly like the main session. */
export function planCustom(input: PlannerInput, slotIds: readonly string[]) {
  return { ...buildDay(selectCustom(input, slotIds), input), kind: 'extra' as const };
}
