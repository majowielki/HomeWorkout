/**
 * What the columns added for engine hold on a row of historical sessions, for
 * tests that build a row by hand. Not a suite and not counted in coverage.
 */
import type { setLogs, workouts } from '../schema';

export const HISTORICAL_WORKOUT_COLUMNS: Pick<
  typeof workouts.$inferSelect,
  'planSchema' | 'sessionPlan' | 'planRevision' | 'revision' | 'timeZone'
> = { planSchema: 1, sessionPlan: null, planRevision: 1, revision: 0, timeZone: null };

export const HISTORICAL_SET_COLUMNS: Pick<
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
