import { dayInput } from '@/domain/__tests__/dayV2Fixtures';
import type { WeekContext } from '@/ai/tools/planPreviewV2';
import { syncWeekV2 } from '@/domain/plan/weekV2';

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
  context.stored = syncWeekV2(context).rows;
  return context;
}
export const restIntent = {
  constraints: [
    { kind: 'rest_day' as const, muscles: [], fromDaysAhead: 1, days: 1, reason: 'busy' as const },
  ],
  note: 'Jutro mam dzień wolny.',
};
