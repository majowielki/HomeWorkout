/**
 * The v1 `PlannedLoad` and the v2 `ResistanceSpec`, in both directions
 * (07 P1.6). Everything the app logs today fits a v1 load, so reading it as a
 * spec loses nothing. The way back is the one that can refuse: a spec made
 * with equipment v1 cannot represent (a barbell, a stack, assistance) is
 * `null`, never an invented dumbbell or a quiet 0 kg (05 §7).
 */

import type { AnchorPosition, PlannedLoad } from '../types';
import {
  BAND_GEOMETRY,
  type BandPosition,
  type BodyweightValue,
  type ExternalMass,
} from './models';
import { RESISTANCE_SCHEMA_VERSION, type ResistanceSpec } from './types';

export interface LegacyOptions {
  /** Which bodyweight movement it is; the exercise id is the natural choice. */
  variantId?: string;
}

export function modelIdOf(load: PlannedLoad): string {
  return load.kind === 'dumbbell'
    ? `dumbbell.${load.mode}`
    : load.kind === 'band'
      ? 'band.long'
      : 'bodyweight';
}

/** The value of a v1 dumbbell: grams, with the convention and implement count of its mode. */
export function dumbbellValue(mode: 'paired' | 'single', kg: number): ExternalMass {
  return {
    kind: 'external_mass',
    massGrams: Math.round(kg * 1000),
    convention: mode === 'paired' ? 'per_hand' : 'total',
    implementCount: mode === 'paired' ? 2 : 1,
  };
}

export function bandValue(bandId: string, position: AnchorPosition): BandPosition {
  return {
    kind: 'band_position',
    bandId,
    positionId: `P${position}`,
    geometryRevision: BAND_GEOMETRY,
  };
}

export function bodyweightValue(variantId: string): BodyweightValue {
  return { kind: 'bodyweight', variantId, addedMassGrams: 0, assistance: null };
}

export function specFromLoad(load: PlannedLoad, options: LegacyOptions = {}): ResistanceSpec {
  const base = {
    schemaVersion: RESISTANCE_SCHEMA_VERSION,
    modelId: modelIdOf(load),
    configurationKey: '',
  } as const;
  switch (load.kind) {
    case 'dumbbell':
      return {
        ...base,
        equipmentInstanceIds: ['dumbbell-set'],
        value: dumbbellValue(load.mode, load.kg),
      };
    case 'band':
      return {
        ...base,
        equipmentInstanceIds: [`band:${load.bandId}`],
        value: bandValue(load.bandId, load.position),
      };
    case 'bodyweight':
      return {
        ...base,
        equipmentInstanceIds: [],
        value: bodyweightValue(options.variantId ?? 'bodyweight'),
      };
  }
}

/** The v1 load a spec stands for, or null when v1 cannot express it. */
export function loadFromSpec(spec: ResistanceSpec): PlannedLoad | null {
  const v = spec.value;
  if (v.kind === 'external_mass') {
    const kg = v.massGrams / 1000;
    if (spec.modelId === 'dumbbell.paired' && v.convention === 'per_hand' && v.implementCount === 2)
      return { kind: 'dumbbell', mode: 'paired', kg };
    if (spec.modelId === 'dumbbell.single' && v.convention === 'total' && v.implementCount === 1)
      return { kind: 'dumbbell', mode: 'single', kg };
    return null;
  }
  if (v.kind === 'band_position') {
    const match = /^P([0-3])$/.exec(v.positionId);
    return spec.modelId === 'band.long' && v.geometryRevision === BAND_GEOMETRY && match
      ? { kind: 'band', bandId: v.bandId, position: Number(match[1]) as AnchorPosition }
      : null;
  }
  if (v.kind === 'bodyweight') {
    return spec.modelId === 'bodyweight' && v.addedMassGrams === 0 && v.assistance === null
      ? { kind: 'bodyweight' }
      : null;
  }
  return null;
}
