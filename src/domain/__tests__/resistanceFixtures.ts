/**
 * Equipment the app does not have yet, as resistance models (07 P1.5, T42-T50).
 * Their only job is to prove that the contract can carry it: a barbell with
 * a limited set of plates, kettlebells, a weight stack with irregular
 * settings, a machine that assists, a vest. They are built on the same
 * `createLadderModel` as the dumbbells, but nothing here is used by the app.
 */
import { createLadderModel } from '../resistance/ladderModel';
import {
  resistanceValueSchema,
  type ResistanceModel,
  type ResistanceValue,
  type ValidationResult,
  type ValueOf,
} from '../resistance/types';

const GRAMS_PER_LB = 453.59237;

const ok = <T extends ResistanceValue>(value: T): ValidationResult<T> => ({ ok: true, value });
const refuse = <T>(reason: string): ValidationResult<T> => ({ ok: false, reason });

function parse<K extends ResistanceValue['kind']>(
  kind: K,
  value: unknown,
): ValidationResult<ValueOf<K>> {
  const parsed = resistanceValueSchema.safeParse(value);
  if (!parsed.success) return refuse(parsed.error.issues[0]?.message ?? 'invalid');
  return parsed.data.kind === kind ? ok(parsed.data as ValueOf<K>) : refuse(`expected ${kind}`);
}

// ------------------------------------------------------------------ barbell

export interface PlatePairs {
  /** Mass of one plate, in the unit of the barbell. */
  mass: number;
  /** How many *pairs* of this plate there are: a bar is loaded symmetrically. */
  pairs: number;
}

interface BarbellConfig {
  total: number;
  /** Plates per side by plate mass. */
  perSide: Map<number, number>;
}

/**
 * Every total the bar can make with the plates there are, loaded
 * symmetrically, each with the arrangement that uses the fewest plates.
 */
export function barbellConfigs(bar: number, plates: readonly PlatePairs[]): BarbellConfig[] {
  const found = new Map<number, BarbellConfig & { count: number }>();
  const walk = (index: number, perSide: Map<number, number>, side: number, count: number) => {
    if (index === plates.length) {
      const total = Math.round((bar + 2 * side) * 1000) / 1000;
      const known = found.get(total);
      if (!known || count < known.count)
        found.set(total, { total, perSide: new Map(perSide), count });
      return;
    }
    const { mass, pairs } = plates[index]!;
    for (let used = 0; used <= pairs; used += 1) {
      walk(index + 1, new Map(perSide).set(mass, used), side + used * mass, count + used);
    }
  };
  walk(0, new Map(), 0, 0);
  return [...found.values()].sort((a, b) => a.total - b.total);
}

export function barbellModel(
  bar: number,
  plates: readonly PlatePairs[],
  unit: 'kg' | 'lb' = 'kg',
): ResistanceModel<ValueOf<'external_mass'>> {
  const gramsPerUnit = unit === 'lb' ? GRAMS_PER_LB : 1000;
  const configs = barbellConfigs(bar, plates);
  const valueOf = (total: number): ValueOf<'external_mass'> => ({
    kind: 'external_mass',
    massGrams: Math.round(total * gramsPerUnit),
    convention: 'total',
    implementCount: 1,
    display: { value: total, unit },
  });
  const byGrams = new Map(configs.map((c) => [valueOf(c.total).massGrams, c]));
  return createLadderModel({
    id: `barbell.${unit}`,
    schemaVersion: 1,
    capabilities: { quantityKinds: ['reps'], perSetResistance: true, relativeStep: 'always' },
    levels: configs.map((c) => ({
      id: `barbell.${unit}/${c.total}${unit}`,
      value: valueOf(c.total),
    })),
    validate(value) {
      const parsed = parse('external_mass', value);
      if (!parsed.ok) return parsed;
      const v = parsed.value;
      return v.convention === 'total' && v.implementCount === 1 && v.display?.unit === unit
        ? ok(v)
        : refuse('a barbell is one implement, total mass, in its own unit');
    },
    effort: (v) => v.massGrams,
    signature: (v) => `external_mass/${v.convention}/x${v.implementCount}`,
    demand(v) {
      const config = byGrams.get(v.massGrams);
      return [
        { resourceId: 'barbell', quantity: 1, configuration: '' },
        ...[...(config?.perSide ?? [])]
          .filter(([, count]) => count > 0)
          .map(([mass, count]) => ({
            resourceId: `plate:${mass}${unit}`,
            quantity: 2 * count,
            configuration: 'pair',
          })),
      ];
    },
  });
}

// --------------------------------------------------------------- kettlebell

/** Kettlebells come in fixed sizes; `count` 2 means one in each hand. */
export function kettlebellModel(sizesKg: readonly number[], count: 1 | 2) {
  return createLadderModel<ValueOf<'external_mass'>>({
    id: `kettlebell.x${count}`,
    schemaVersion: 1,
    capabilities: { quantityKinds: ['reps'], perSetResistance: true, relativeStep: 'always' },
    levels: sizesKg.map((kg) => ({
      id: `kettlebell.x${count}/${kg}`,
      value: {
        kind: 'external_mass',
        massGrams: kg * 1000,
        convention: count === 2 ? 'per_hand' : 'total',
        implementCount: count,
      },
    })),
    validate(value) {
      const parsed = parse('external_mass', value);
      if (!parsed.ok) return parsed;
      return parsed.value.implementCount === count &&
        sizesKg.includes(parsed.value.massGrams / 1000)
        ? parsed
        : refuse('not a kettlebell size of this set');
    },
    effort: (v) => v.massGrams,
    signature: (v) => `external_mass/${v.convention}/x${v.implementCount}`,
    demand: (v) => [
      { resourceId: `kettlebell:${v.massGrams}`, quantity: count, configuration: '' },
    ],
  });
}

// ------------------------------------------------- weight stack and cable

export interface StackSetting {
  id: string;
  /** What the pin shows; not a force, and not evenly spaced. */
  shown: number;
}

/** A selector-pin machine or a cable station. The numbers on the dial say nothing about effort. */
export function stackModel(machineId: string, settings: readonly StackSetting[]) {
  const order = new Map(settings.map((s, i) => [s.id, i + 1]));
  return createLadderModel<ValueOf<'machine_setting'>>({
    id: 'machine.stack',
    schemaVersion: 1,
    capabilities: { quantityKinds: ['reps'], perSetResistance: true, relativeStep: 'never' },
    levels: settings.map((s) => ({
      id: `machine.stack/${machineId}/${s.id}`,
      value: { kind: 'machine_setting', settingId: s.id, displayValue: s.shown, displayUnit: 'kg' },
    })),
    validate(value) {
      const parsed = parse('machine_setting', value);
      if (!parsed.ok) return parsed;
      const known = settings.find((s) => s.id === parsed.value.settingId);
      return known && known.shown === parsed.value.displayValue
        ? parsed
        : refuse('not a setting of this machine');
    },
    effort: (v) => order.get(v.settingId)!,
    // Another machine is another resistance, even at the same number.
    signature: () => `machine_setting/${machineId}`,
    demand: (v) => [
      { resourceId: `machine:${machineId}`, quantity: 1, configuration: v.settingId },
    ],
    step: () => null,
  });
}

// ------------------------------------------------------------ bodyweight+

/** A machine that carries part of the body: less assistance is harder (05 §7, T45). */
export function assistedModel(variantId: string, assistanceKg: readonly number[]) {
  const sorted = [...assistanceKg].sort((a, b) => b - a); // most help first = easiest first
  return createLadderModel<ValueOf<'bodyweight'>>({
    id: 'bodyweight.assisted',
    schemaVersion: 1,
    capabilities: { quantityKinds: ['reps'], perSetResistance: true, relativeStep: 'never' },
    levels: sorted.map((kg) => ({
      id: `bodyweight.assisted/${variantId}/${kg}`,
      value: {
        kind: 'bodyweight',
        variantId,
        addedMassGrams: 0,
        assistance: { massGrams: kg * 1000 },
      },
    })),
    validate(value) {
      const parsed = parse('bodyweight', value);
      if (!parsed.ok) return parsed;
      const v = parsed.value;
      return v.variantId === variantId &&
        v.addedMassGrams === 0 &&
        v.assistance !== null &&
        sorted.includes(v.assistance.massGrams / 1000)
        ? parsed
        : refuse('not an assistance level of this machine');
    },
    // Less assistance, more effort. Zero is "no assistance", the hardest step, and a real value.
    effort: (v) => -(v.assistance?.massGrams ?? 0),
    signature: (v) => `bodyweight/${v.variantId}/assisted`,
    demand: (v) => [
      { resourceId: 'assist-machine', quantity: 1, configuration: String(v.assistance?.massGrams) },
    ],
    // The size of a step depends on the person's body mass, which a model does not know.
    step: () => null,
  });
}

/** Bodyweight with a vest or a belt: the added mass is the effort, the person's own mass is context. */
export function weightedBodyweightModel(variantId: string, addedKg: readonly number[]) {
  return createLadderModel<ValueOf<'bodyweight'>>({
    id: 'bodyweight.weighted',
    schemaVersion: 1,
    capabilities: { quantityKinds: ['reps'], perSetResistance: true, relativeStep: 'never' },
    levels: addedKg.map((kg) => ({
      id: `bodyweight.weighted/${variantId}/${kg}`,
      value: {
        kind: 'bodyweight',
        variantId,
        addedMassGrams: Math.round(kg * 1000),
        assistance: null,
      },
    })),
    validate(value) {
      const parsed = parse('bodyweight', value);
      if (!parsed.ok) return parsed;
      return parsed.value.variantId === variantId && parsed.value.assistance === null
        ? parsed
        : refuse('not a weighted variant of this exercise');
    },
    effort: (v) => v.addedMassGrams,
    signature: (v) => `bodyweight/${v.variantId}/weighted`,
    demand: (v) => [
      { resourceId: 'weight-vest', quantity: 1, configuration: String(v.addedMassGrams) },
    ],
    step: () => null,
  });
}
