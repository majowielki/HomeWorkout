/**
 * The three resistance models the app has today — a pair or a single
 * adjustable dumbbell, the long bands, bodyweight — expressed in the v2
 * contract. They are built on the v1 ladders (`inventory.ts`, `ladder.ts`) and
 * not beside them, so what the planner does with a load and what the model
 * says about it cannot drift apart; the tests walk both over every step.
 */

import { BAND_CONFIG, PROGRESSION_CONFIG } from '../config/training';
import {
  BANDS,
  type BandSpec,
  DUMBBELLS,
  type DumbbellInventory,
  dumbbellLadder,
} from '../inventory';
import { estimatedPeakKg, estimateBandLoad } from '../progression/calibration';
import { bandLoadLadder } from '../progression/ladder';
import type { AnchorPosition, BandCalibrationMap, DumbbellMode } from '../types';
import { createLadderModel } from './ladderModel';
import {
  resistanceValueSchema,
  type ResistanceLevel,
  type ResistanceModel,
  type ValidationResult,
  type ValueOf,
} from './types';

export type ExternalMass = ValueOf<'external_mass'>;
export type BandPosition = ValueOf<'band_position'>;
export type BodyweightValue = ValueOf<'bodyweight'>;

const fail = <T>(reason: string): ValidationResult<T> => ({ ok: false, reason });

/** Parse a value against the shared schema and narrow it to one kind. */
function parseKind<K extends 'external_mass' | 'band_position' | 'bodyweight'>(
  kind: K,
  value: unknown,
): ValidationResult<ValueOf<K>> {
  const parsed = resistanceValueSchema.safeParse(value);
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);
  if (parsed.data.kind !== kind) return fail(`expected ${kind}, got ${parsed.data.kind}`);
  return { ok: true, value: parsed.data as ValueOf<K> };
}

const toGrams = (kg: number) => Math.round(kg * 1000);

// ---------------------------------------------------------------- dumbbells

/** `dumbbell.paired`: kilograms in each of two hands. `dumbbell.single`: everything on one implement. */
export function createDumbbellModel(
  mode: DumbbellMode,
  inventory: DumbbellInventory = DUMBBELLS,
): ResistanceModel<ExternalMass> {
  const paired = mode === 'paired';
  const convention = paired ? 'per_hand' : 'total';
  const implementCount = paired ? 2 : 1;
  const valueOf = (massGrams: number): ExternalMass => ({
    kind: 'external_mass',
    massGrams,
    convention,
    implementCount,
  });
  const id = `dumbbell.${mode}`;
  return createLadderModel<ExternalMass>({
    id,
    schemaVersion: 1,
    capabilities: {
      quantityKinds: ['reps', 'duration'],
      perSetResistance: true,
      relativeStep: 'always',
    },
    levels: dumbbellLadder(mode, inventory).map((kg) => ({
      id: `${id}/${toGrams(kg)}`,
      value: valueOf(toGrams(kg)),
    })),
    validate(value) {
      const parsed = parseKind('external_mass', value);
      if (!parsed.ok) return parsed;
      return parsed.value.convention === convention &&
        parsed.value.implementCount === implementCount
        ? parsed
        : fail(`${id} is ${convention} x${implementCount}`);
    },
    effort: (v) => v.massGrams,
    signature: (v) => `external_mass/${v.convention}/x${v.implementCount}`,
    // One adjustable set: a pair and a single cannot both be loaded from it at once.
    demand: (v) => [
      {
        resourceId: 'dumbbell-set',
        quantity: v.implementCount,
        configuration: `${mode}:${v.massGrams}`,
      },
    ],
  });
}

// -------------------------------------------------------------------- bands

export const BAND_GEOMETRY = `anchor-${BAND_CONFIG.anchorStepCm}cm-v1`;

export interface BandModelParams {
  /** Stretch per repetition for the movement, which turns a calibration into a force. */
  romCm: number;
  calibrations?: BandCalibrationMap;
  bands?: readonly BandSpec[];
}

const positionId = (position: number) => `P${position}`;

/** `band.long`: the long bands in the order of the inventory, each at anchor positions P0-P3. */
export function createBandModel(params: BandModelParams): ResistanceModel<BandPosition> {
  const bands = params.bands ?? BANDS;
  const calibrations = params.calibrations ?? {};
  const ladder = bandLoadLadder(
    bands[0]!.id,
    params.romCm,
    calibrations,
    [...bands],
    PROGRESSION_CONFIG,
  );
  const valueOf = (bandId: string, position: number): BandPosition => ({
    kind: 'band_position',
    bandId,
    positionId: positionId(position),
    geometryRevision: BAND_GEOMETRY,
  });
  const levelOf = (bandId: string, position: number): ResistanceLevel<BandPosition> => ({
    id: `band.long/${bandId}/${positionId(position)}`,
    value: valueOf(bandId, position),
  });
  const levels = bands.flatMap((b) => [0, 1, 2, 3].map((p) => levelOf(b.id, p)));

  /** The v1 load for a value, or null when the band or position is not on this ladder. */
  const loadOf = (value: BandPosition) => {
    const match = /^P([0-3])$/.exec(value.positionId);
    if (!match) return null;
    const load = {
      kind: 'band' as const,
      bandId: value.bandId,
      position: Number(match[1]) as AnchorPosition,
    };
    return ladder.rank(load) === null ? null : load;
  };
  const rankOf = (value: BandPosition) => {
    const load = loadOf(value);
    return load === null ? null : ladder.rank(load);
  };
  const peak = (value: BandPosition): number | null => {
    const load = loadOf(value);
    return load === null
      ? null
      : estimatedPeakKg(
          estimateBandLoad(calibrations[load.bandId] ?? null, load.position, params.romCm),
        );
  };

  return {
    id: 'band.long',
    schemaVersion: 1,
    capabilities: {
      quantityKinds: ['reps', 'duration'],
      perSetResistance: true,
      relativeStep: 'when_calibrated',
    },
    validate(value) {
      const parsed = parseKind('band_position', value);
      if (!parsed.ok) return parsed;
      if (parsed.value.geometryRevision !== BAND_GEOMETRY) return fail('another anchor geometry');
      return loadOf(parsed.value) ? parsed : fail('not a band position of this inventory');
    },
    levels: () => levels,
    compare(a, b) {
      const ra = rankOf(a);
      const rb = rankOf(b);
      if (ra === null || rb === null || a.geometryRevision !== b.geometryRevision)
        return 'incomparable';
      return ra < rb ? 'easier' : ra > rb ? 'harder' : 'equal';
    },
    nextHarder(current) {
      const load = loadOf(current);
      const step = load ? ladder.up(load) : null;
      return step && step.load.kind === 'band'
        ? levelOf(step.load.bandId, step.load.position)
        : null;
    },
    nextEasier(current) {
      const load = loadOf(current);
      const down = load ? ladder.down(load) : null;
      return down && down.kind === 'band' ? levelOf(down.bandId, down.position) : null;
    },
    resourceDemand: (v) => [
      { resourceId: `band:${v.bandId}`, quantity: 1, configuration: v.positionId },
    ],
    comparisonSignature: (v) => `band_position/${v.geometryRevision}`,
    relativeStep(from, to) {
      const a = peak(from);
      const b = peak(to);
      return a !== null && b !== null && a > 0 ? b / a - 1 : null;
    },
  };
}

// --------------------------------------------------------------- bodyweight

/** `bodyweight`: one step, the body itself; progress is in repetitions, seconds and variants. */
export function createBodyweightModel(variantId: string): ResistanceModel<BodyweightValue> {
  const value: BodyweightValue = {
    kind: 'bodyweight',
    variantId,
    addedMassGrams: 0,
    assistance: null,
  };
  return createLadderModel<BodyweightValue>({
    id: 'bodyweight',
    schemaVersion: 1,
    capabilities: {
      quantityKinds: ['reps', 'duration'],
      perSetResistance: false,
      relativeStep: 'never',
    },
    levels: [{ id: `bodyweight/${variantId}`, value }],
    validate(candidate) {
      const parsed = parseKind('bodyweight', candidate);
      if (!parsed.ok) return parsed;
      return parsed.value.variantId === variantId &&
        parsed.value.addedMassGrams === 0 &&
        parsed.value.assistance === null
        ? parsed
        : fail(`bodyweight of ${variantId} carries no added mass and no assistance`);
    },
    effort: () => 0,
    signature: (v) => `bodyweight/${v.variantId}`,
    demand: () => [],
    step: () => null,
  });
}
