/**
 * Equipment as the person has it, and what an exercise needs of it (engine,
 * 05 §4). v1 knew a list of kinds ("dumbbell", "band") interpreted once as AND
 * and once as OR. The room has *things*: a bar with a mass, a number of plates,
 * a bench that adjusts. An exercise needs some of them together (a barbell
 * *and* plates *and* a rack) or one of several (an adjustable bench *or* a flat
 * one), and two exercises in a superset may need the same thing at once.
 */

import { z } from 'zod';

/** A fact about how a piece of equipment is set up, compared as written (e.g. `{ angle: 30 }`). */
const settingValue = z.union([z.string(), z.number(), z.boolean()]);

export const equipmentInstanceSchema = z.strictObject({
  id: z.string().min(1),
  /** The kind of thing: `barbell`, `adjustable-dumbbell-set`, `bench`. */
  typeId: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  label: z.string().min(1),
  status: z.enum(['available', 'unavailable', 'retired']),
  /** Where it is; the home inventory never lends plates to a gym's profile. */
  locationId: z.string().min(1).nullable(),
  quantity: z.number().int().positive(),
  /** What it can be used for: `rack`, `adjustable-incline`. */
  capabilities: z.array(z.string().min(1)),
  configuration: z.record(z.string(), settingValue),
  /** Raised on every change; history keeps the revision it was done with. */
  revision: z.number().int().nonnegative(),
});

export type EquipmentInstance = z.infer<typeof equipmentInstanceSchema>;

/** What an exercise needs: all of the parts, or one of several alternatives. */
export type EquipmentRequirement =
  | {
      kind: 'capability';
      capability: string;
      quantity: number;
      /** Settings an instance must have to count (e.g. `{ adjustable: true }`). */
      constraints: Record<string, string | number | boolean>;
    }
  | { kind: 'instance'; instanceId: string; quantity: number }
  | { kind: 'one_of'; alternatives: EquipmentRequirement[][] };

const constraints = z.record(z.string(), settingValue);

export const equipmentRequirementSchema: z.ZodType<EquipmentRequirement> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('capability'),
      capability: z.string().min(1),
      quantity: z.number().int().positive(),
      constraints,
    }),
    z.strictObject({
      kind: z.literal('instance'),
      instanceId: z.string().min(1),
      quantity: z.number().int().positive(),
    }),
    z.strictObject({
      kind: z.literal('one_of'),
      alternatives: z.array(z.array(equipmentRequirementSchema).min(1)).min(2),
    }),
  ]),
);

/** Which concrete things a prepared setup uses, and how many of each (04 §7). */
export interface ResourceAssignment {
  instanceId: string;
  quantity: number;
}

const usable = (i: EquipmentInstance, locationId: string | null) =>
  i.status === 'available' && (locationId === null || i.locationId === locationId);

/**
 * Whether the equipment on hand meets a set of requirements at once — every
 * one of them (AND), where `one_of` lets any of its alternatives do. Only
 * available things in the place the session is in count, and the same thing
 * is never counted for two requirements of one exercise.
 */
export function requirementsMet(
  requirements: readonly EquipmentRequirement[],
  instances: readonly EquipmentInstance[],
  locationId: string | null = null,
): boolean {
  const left = new Map(
    instances.filter((i) => usable(i, locationId)).map((i) => [i.id, i.quantity]),
  );
  return solve(requirements, instances, left);
}

/**
 * Tries to meet the first requirement and then the rest from what is left. A
 * choice that fails is undone before the next one is tried, so a thing used
 * for one requirement is not also counted for another.
 */
function solve(
  requirements: readonly EquipmentRequirement[],
  instances: readonly EquipmentInstance[],
  left: Map<string, number>,
): boolean {
  const [first, ...rest] = requirements;
  if (first === undefined) return true;
  if (first.kind === 'one_of') {
    return first.alternatives.some((alternative) =>
      solve([...alternative, ...rest], instances, left),
    );
  }
  const candidates =
    first.kind === 'instance'
      ? instances.filter((i) => i.id === first.instanceId)
      : instances.filter(
          (i) =>
            i.capabilities.includes(first.capability) &&
            Object.entries(first.constraints).every(([k, v]) => i.configuration[k] === v),
        );
  return candidates.some((i) => {
    const have = left.get(i.id) ?? 0;
    const take = Math.min(first.quantity, have);
    if (take === 0) return false;
    left.set(i.id, have - take);
    // What one thing cannot give, another may: the rest is asked for as a requirement of its own.
    const remaining: EquipmentRequirement[] =
      take < first.quantity ? [{ ...first, quantity: first.quantity - take }] : [];
    const ok = solve([...remaining, ...rest], instances, left);
    left.set(i.id, have);
    return ok;
  });
}
