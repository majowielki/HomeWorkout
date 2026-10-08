import { BASE_POLICY, type DayPolicy, resolveDayPolicy } from '../policy/dayPolicy';
import { buildDay, type PlannerInput, selectDay } from './dayPlanner';
import { isEligible } from './eligibility';
import type { MuscleGroup } from '../types';
import type { DaySelection } from './types';

/** The policy an extra session is planned under unless the caller resolved its own. */
const extraPolicy = (input: PlannerInput) => resolveDayPolicy(BASE_POLICY, input.week, 'extra');

/** Only requested working slots; no automatic light practice or mobility. */
export function selectCustom(
  input: PlannerInput,
  slotIds: readonly string[],
  policy: DayPolicy = extraPolicy(input),
): DaySelection {
  const slots = input.slots.filter((s) => s.kind !== 'filler' && slotIds.includes(s.id));
  const selections = Object.fromEntries(
    Object.entries(input.block.selections).filter(([, id]) => {
      const e = input.catalog[id];
      return e !== undefined && isEligible(e, input.eligibility);
    }),
  );
  return selectDay(
    { ...input, slots, block: { ...input.block, selections } },
    policy.planner,
    policy.training,
  );
}

/** A slot's availability independent of the other choices and the session budget. */
export function extraSessionOptions(input: PlannerInput, policy: DayPolicy = extraPolicy(input)) {
  return input.slots
    .filter((s) => s.kind !== 'filler')
    .map((slot) => {
      const selection = selectCustom(input, [slot.id], policy);
      return {
        slotId: slot.id,
        item: selection.items[0] ?? null,
        reason: selection.skipped[0]?.reason ?? null,
      };
    });
}

/**
 * The available slots whose exercise trains one of these muscles as a
 * primary — what "an extra session for the chest" means to the planner.
 */
export function slotsForFocus(
  input: PlannerInput,
  muscles: readonly MuscleGroup[],
  policy: DayPolicy = extraPolicy(input),
): string[] {
  return extraSessionOptions(input, policy).flatMap((option) =>
    // An option's item always comes from the catalogue it was selected from.
    option.item &&
    input.catalog[option.item.exerciseId]!.primaryMuscles.some((m) => muscles.includes(m))
      ? [option.slotId]
      : [],
  );
}

/** Loads from actual logs, ordered and validated exactly like the main session. */
export function planCustom(
  input: PlannerInput,
  slotIds: readonly string[],
  policy: DayPolicy = extraPolicy(input),
) {
  return {
    ...buildDay(selectCustom(input, slotIds, policy), input, policy.planner, policy.training),
    kind: 'extra' as const,
  };
}
