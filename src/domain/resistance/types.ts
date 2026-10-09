/**
 * What resists the lifter, as data (engine, 05 §5-§6).
 *
 * v1 knew three loads — a dumbbell mass, a band position, bodyweight — and the
 * planner, the logger and the history were all written against exactly those.
 * A resistance *model* owns the meaning of one kind of load: which values are
 * legal, which are reachable with the equipment at hand, which is harder, and
 * what physical things a value needs. The planner and the progression talk
 * only to this interface, so a barbell, a weight stack or an assisted machine
 * join by registering a model, not by changing the day selector.
 */

import { z } from 'zod';

/** An integer number of grams: the one stored unit of mass, so 2 kg and 2000 g never differ. */
const grams = z.number().int().nonnegative();

/** The setting as the person knows it, kept when grams cannot reproduce it exactly (lb plates). */
const displayMass = z.strictObject({ value: z.number().positive(), unit: z.enum(['kg', 'lb']) });

export const resistanceValueSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('external_mass'),
    massGrams: grams,
    /** `total`: everything on the implement. `per_hand`: each of `implementCount` implements. */
    convention: z.enum(['total', 'per_hand']),
    implementCount: z.number().int().min(1).max(4),
    display: displayMass.optional(),
  }),
  z.strictObject({
    kind: z.literal('band_position'),
    bandId: z.string().min(1),
    positionId: z.string().min(1),
    /** Where the band is anchored and how it is stretched: another geometry is another resistance. */
    geometryRevision: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('machine_setting'),
    settingId: z.string().min(1),
    /** What the stack shows. A label, not a force: 30 on one machine is not 30 on another. */
    displayValue: z.number().nullable(),
    displayUnit: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal('bodyweight'),
    variantId: z.string().min(1),
    addedMassGrams: grams,
    /** Assisting mass: *more* is easier. `null`: this variant is not assisted; `0`: assisted by nothing. */
    assistance: z.strictObject({ massGrams: grams }).nullable(),
  }),
  z.strictObject({ kind: z.literal('ordinal'), levelId: z.string().min(1) }),
]);

export type ResistanceValue = z.infer<typeof resistanceValueSchema>;

/** The value of one kind, e.g. `ValueOf<'external_mass'>`. */
export type ValueOf<K extends ResistanceValue['kind']> = Extract<ResistanceValue, { kind: K }>;

export const RESISTANCE_SCHEMA_VERSION = 1;

export const resistanceSpecSchema = z.strictObject({
  schemaVersion: z.literal(RESISTANCE_SCHEMA_VERSION),
  /** Which registered model gives `value` its meaning. */
  modelId: z.string().min(1),
  /** The pieces of equipment the value was made with; empty for bodyweight. */
  equipmentInstanceIds: z.array(z.string().min(1)),
  /** What else about the setup changes comparability (cable ratio, bench angle); `''` when nothing does. */
  configurationKey: z.string(),
  value: resistanceValueSchema,
});

export type ResistanceSpec = z.infer<typeof resistanceSpecSchema>;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** One step the equipment can make, with a stable id. */
export interface ResistanceLevel<T> {
  /** Stable across sessions and releases; the same step is always the same id. */
  id: string;
  value: T;
}

/** `harder` and `easier` are about the lifter's effort, which is not the same direction as the number. */
export type Comparison = 'easier' | 'equal' | 'harder' | 'incomparable';

/**
 * A physical thing a value needs, and in which setup. Two claims on the same
 * resource with different `configuration` cannot be held at once: one pair of
 * adjustable dumbbells is not 2 x 8 kg and 1 x 14 kg at the same time.
 */
export interface ResourceClaim {
  resourceId: string;
  quantity: number;
  configuration: string;
}

export type ResourceDemand = readonly ResourceClaim[];

/** What a model can do, so a policy or the logger can refuse what it cannot support (05 §8). */
export interface ModelCapabilities {
  /** The measures this resistance is used with. */
  quantityKinds: readonly ('reps' | 'duration' | 'distance')[];
  /** Whether a set can carry a different value than its neighbours (mixed sets, a probe set). */
  perSetResistance: boolean;
  /** `always`: a step's size is known. `when_calibrated`: only with measurements. `never`: an unknown jump. */
  relativeStep: 'always' | 'when_calibrated' | 'never';
}

/**
 * The contract every resistance model keeps (05 §6). A model is built for one
 * exercise and one inventory, so nothing here takes a context or reads a
 * database.
 */
export interface ResistanceModel<T extends ResistanceValue = ResistanceValue> {
  readonly id: string;
  readonly schemaVersion: number;
  readonly capabilities: ModelCapabilities;
  /** Whether `value` is something this model can represent, at all (not whether it is reachable). */
  validate(value: unknown): ValidationResult<T>;
  /** Every step the equipment can make, from easiest to hardest. */
  levels(): readonly ResistanceLevel<T>[];
  compare(a: T, b: T): Comparison;
  /** The nearest step that is harder than `current`, which need not be a step itself. */
  nextHarder(current: T): ResistanceLevel<T> | null;
  nextEasier(current: T): ResistanceLevel<T> | null;
  resourceDemand(value: T): ResourceDemand;
  /** Equal for values whose results may be compared with each other; differs when they may not. */
  comparisonSignature(value: T): string;
  /** How much harder `to` is than `from` as a fraction (0.25 = +25%), or null when that is not known. */
  relativeStep(from: T, to: T): number | null;
}
