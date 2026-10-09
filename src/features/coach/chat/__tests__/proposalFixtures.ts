import { dayInput } from '@/domain/__tests__/dayFixtures';
import type { WeekContext } from '@/ai/tools/planPreview';
import { syncWeek } from '@/domain/plan/week';

export function proposalSnapshot(done = false): WeekContext {
  const input = dayInput();
  const context: WeekContext = {
    ...input,
    endedBlocks: [],
    versions: input.session.versions,
    snapshotFingerprint: input.session.snapshotFingerprint,
    stored: [],
    trainedDates: new Set(done ? [input.asOf] : []),
  };
  context.stored = syncWeek(context).rows;
  return context;
}
export const restIntent = {
  constraints: [
    { kind: 'rest_day' as const, muscles: [], fromDaysAhead: 1, days: 1, reason: 'busy' as const },
  ],
  note: 'Jutro mam dzień wolny.',
};
