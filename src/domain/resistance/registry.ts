/**
 * Which resistance models exist, and how a catalogue entry names one
 * (05 §8). The registry is typed code, never data to execute: a catalogue
 * chooses a known model id and gives it parameters, and an id nobody
 * registered is refused instead of guessed at, so an exercise on equipment the
 * app cannot yet log never gets an automatic prescription (T51).
 */

import { z } from 'zod';

import { BANDS, type BandSpec, DUMBBELLS, type DumbbellInventory } from '../inventory';
import type { BandCalibrationMap } from '../types';
import { createBandModel, createBodyweightModel, createDumbbellModel } from './models';
import type { ResistanceModel } from './types';

/** What models are made against: the equipment on hand and the measurements of it. */
export interface ModelContext {
  dumbbells: DumbbellInventory;
  bands: readonly BandSpec[];
  bandCalibrations: BandCalibrationMap;
}

export const DEFAULT_MODEL_CONTEXT: ModelContext = {
  dumbbells: DUMBBELLS,
  bands: BANDS,
  bandCalibrations: {},
};

export interface ModelFactory {
  /** Checks what the catalogue gave as parameters; `create` only ever sees what passed. */
  parameters: z.ZodType<unknown>;
  create(parameters: unknown, ctx: ModelContext): ResistanceModel;
}

/** A factory whose `create` sees its parameters typed by their own schema. */
export function defineModel<P>(
  parameters: z.ZodType<P>,
  create: (parameters: P, ctx: ModelContext) => ResistanceModel,
): ModelFactory {
  return { parameters, create: (p, ctx) => create(p as P, ctx) };
}

const noParameters = z.strictObject({});

export const BUILT_IN_FACTORIES: Readonly<Record<string, ModelFactory>> = {
  'dumbbell.paired': defineModel(noParameters, (_, ctx) =>
    createDumbbellModel('paired', ctx.dumbbells),
  ),
  'dumbbell.single': defineModel(noParameters, (_, ctx) =>
    createDumbbellModel('single', ctx.dumbbells),
  ),
  // The stretch per repetition turns a calibration into a force.
  'band.long': defineModel(z.strictObject({ romCm: z.number().nonnegative() }), (p, ctx) =>
    createBandModel({ romCm: p.romCm, bands: ctx.bands, calibrations: ctx.bandCalibrations }),
  ),
  bodyweight: defineModel(z.strictObject({ variantId: z.string().min(1) }), (p) =>
    createBodyweightModel(p.variantId),
  ),
};

export interface ModelRef {
  id: string;
  parameters?: unknown;
}

export type ModelResult =
  | { ok: true; model: ResistanceModel }
  | { ok: false; reason: 'unknown_model' | 'invalid_parameters' };

export interface ResistanceRegistry {
  has(id: string): boolean;
  ids(): string[];
  create(ref: ModelRef, ctx?: ModelContext): ModelResult;
}

/**
 * A registry of the built-in models and any more the caller adds. A new kind
 * of equipment is one more entry here; nothing that plans a day changes.
 */
export function createResistanceRegistry(
  extra: Readonly<Record<string, ModelFactory>> = {},
): ResistanceRegistry {
  const factories = { ...BUILT_IN_FACTORIES, ...extra };
  return {
    has: (id) => Object.hasOwn(factories, id),
    ids: () => Object.keys(factories).sort(),
    create(ref, ctx = DEFAULT_MODEL_CONTEXT) {
      if (!Object.hasOwn(factories, ref.id)) return { ok: false, reason: 'unknown_model' };
      const factory = factories[ref.id]!;
      const parsed = factory.parameters.safeParse(ref.parameters ?? {});
      if (!parsed.success) return { ok: false, reason: 'invalid_parameters' };
      return { ok: true, model: factory.create(parsed.data, ctx) };
    },
  };
}

export const RESISTANCE_REGISTRY: ResistanceRegistry = createResistanceRegistry();
