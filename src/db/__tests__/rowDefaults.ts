/**
 * What the columns added for engine v2 hold on a row of the first engine, for
 * tests that build a row by hand. Not a suite and not counted in coverage.
 */
import type { setLogs, workouts } from '../schema';

export const V1_WORKOUT_COLUMNS: Pick<
  typeof workouts.$inferSelect,
  'planSchema' | 'planV2' | 'planRevision' | 'revision' | 'timeZone'
> = { planSchema: 1, planV2: null, planRevision: 1, revision: 0, timeZone: null };

export const V1_SET_COLUMNS: Pick<
  typeof setLogs.$inferSelect,
  | 'commandId'
  | 'plannedSetId'
  | 'exposureId'
  | 'logicalSetId'
  | 'role'
  | 'comparisonKey'
  | 'progressionScope'
  | 'source'
  | 'performedOn'
  | 'revision'
  | 'deletedAt'
  | 'observation'
> = {
  commandId: null,
  plannedSetId: null,
  exposureId: null,
  logicalSetId: null,
  role: null,
  comparisonKey: null,
  progressionScope: null,
  source: null,
  performedOn: null,
  revision: 1,
  deletedAt: null,
  observation: null,
};
