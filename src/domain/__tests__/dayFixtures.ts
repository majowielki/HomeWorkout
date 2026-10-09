/**
 * The shipped catalogue and a person to plan for (engine, P4). Not a suite
 * and not counted in coverage.
 */
import exercisesJson from '@data/exercises.json';
import slotsJson from '@data/slots.json';
import { slotCatalogueSchema } from '@data/slots.schema';

import { defaultPreferences } from '../preferences/preferences';
import { nextCandidate } from '../plan/blockSelection';
import type { DayInput } from '../plan/day';
import type { EligibilityContext } from '../plan/eligibility';
import type { Exercise } from '../types';
import { HARD_ONLY } from './fixtures';
import { HASH_A } from './planFixtures';
import { VERSIONS } from './compileFixtures';
const rotateSelections = (
  _previous: null,
  slots: readonly import('../plan/types').Slot[],
  catalog: Readonly<Record<string, import('../types').Exercise>>,
  eligibility: import('../plan/eligibility').EligibilityContext,
) =>
  Object.fromEntries(
    slots.flatMap((slot) => {
      const id = nextCandidate(slot, undefined, catalog, eligibility);
      return id ? [[slot.id, id]] : [];
    }),
  );

export const EXERCISES = (exercisesJson as { exercises: Exercise[] }).exercises;
export const CATALOG: Record<string, Exercise> = Object.fromEntries(
  EXERCISES.map((e) => [e.id, e]),
);
export const { slots: SLOTS } = slotCatalogueSchema.parse(slotsJson);

export const ELIGIBILITY: EligibilityContext = { profile: HARD_ONLY, excludedIds: new Set() };

export const SELECTIONS = rotateSelections(null, SLOTS, CATALOG, ELIGIBILITY);

export function dayInput(patch: Partial<DayInput> = {}): DayInput {
  return {
    asOf: '2026-10-05',
    catalog: CATALOG,
    slots: SLOTS,
    eligibility: ELIGIBILITY,
    block: {
      index: 1,
      startedOn: '2026-10-05',
      deloadFrom: null,
      deloadReason: null,
      selections: SELECTIONS,
    },
    records: [],
    rides: [],
    daily: [],
    preferences: defaultPreferences(),
    session: {
      sessionId: 's1',
      planRevision: 1,
      kind: 'main',
      versions: VERSIONS,
      snapshotFingerprint: HASH_A,
      inputFingerprint: HASH_A,
    },
    ...patch,
  };
}
