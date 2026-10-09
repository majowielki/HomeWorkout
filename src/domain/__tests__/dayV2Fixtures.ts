/**
 * The shipped catalogue and a person to plan for (engine v2, P4). Not a suite
 * and not counted in coverage.
 */
import exercisesJson from '@data/exercises.json';
import slotsJson from '@data/slots.json';
import { slotCatalogueSchema } from '@data/slots.schema';

import { defaultPreferences } from '../preferences/preferences';
import { rotateSelections } from '../plan/block';
import type { DayInputV2 } from '../plan/dayV2';
import type { EligibilityContext } from '../plan/eligibility';
import type { Exercise } from '../types';
import { HARD_ONLY } from './fixtures';
import { HASH_A } from './planV2Fixtures';
import { VERSIONS } from './compileFixtures';

export const EXERCISES = (exercisesJson as { exercises: Exercise[] }).exercises;
export const CATALOG: Record<string, Exercise> = Object.fromEntries(
  EXERCISES.map((e) => [e.id, e]),
);
export const { slots: SLOTS } = slotCatalogueSchema.parse(slotsJson);

export const ELIGIBILITY: EligibilityContext = { profile: HARD_ONLY, excludedIds: new Set() };

export const SELECTIONS = rotateSelections(null, SLOTS, CATALOG, ELIGIBILITY);

export function dayInput(patch: Partial<DayInputV2> = {}): DayInputV2 {
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
