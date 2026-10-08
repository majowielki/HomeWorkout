import type { PlanningSnapshot } from '@/features/plan/planningSnapshot';
import { extraInput } from '@/domain/__tests__/extraFixtures';
import { syncWeek } from '@/domain/plan/weekSync';

export function proposalSnapshot(done = false): PlanningSnapshot {
  const day = extraInput();
  const source: PlanningSnapshot['source'] = {
    asOf: day.asOf,
    catalog: { ...day.catalog },
    profile: day.eligibility.profile,
    excludedIds: [],
    sessions: [],
    rides: [],
    daily: [],
    calibrations: {},
    lastSessionDate: done ? day.asOf : null,
  };
  const input: PlanningSnapshot['input'] = {
    ...day,
    lastSessionDate: source.lastSessionDate,
    stored: [],
    trainedDates: new Set(done ? [day.asOf] : []),
    week: { restWeekdays: [] },
  };
  input.stored = syncWeek(input).rows;
  return {
    source,
    input,
    current: { id: 'block', state: day.block },
    advance: { block: day.block, closed: null, events: [], replacedSlots: [] },
  };
}

export const restIntent = {
  constraints: [
    { kind: 'rest_day' as const, muscles: [], fromDaysAhead: 1, days: 1, reason: 'busy' as const },
  ],
  note: 'Jutro mam dzień wolny.',
};
