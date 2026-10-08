import { loadPlannerSource } from '@/db/repositories/plannerSource';
import { getTrainingWeek } from '@/db/repositories/profile';
import { getCurrentBlock } from '@/db/repositories/trainingBlocks';
import { getActiveConstraints, getPlannedDays, getTrainedDates } from '@/db/repositories/weekPlan';
import { proposalSnapshot } from '@/features/coach/chat/__tests__/proposalFixtures';
import {
  buildPlanningSnapshot,
  loadPlanningSnapshot,
  planningSnapshotKey,
} from '../planningSnapshot';

jest.mock('@/db/repositories/plannerSource', () => ({ loadPlannerSource: jest.fn() }));
jest.mock('@/db/repositories/profile', () => ({ getTrainingWeek: jest.fn() }));
jest.mock('@/db/repositories/trainingBlocks', () => ({ getCurrentBlock: jest.fn() }));
jest.mock('@/db/repositories/weekPlan', () => ({
  getActiveConstraints: jest.fn(),
  getPlannedDays: jest.fn(),
  getTrainedDates: jest.fn(),
}));

const { source, input, current } = proposalSnapshot();

describe('planning snapshot', () => {
  it('reads two weeks back and the stored days ahead, then builds the input once', async () => {
    jest.mocked(loadPlannerSource).mockResolvedValue(source);
    jest.mocked(getCurrentBlock).mockResolvedValue(current);
    jest.mocked(getActiveConstraints).mockResolvedValue([]);
    jest.mocked(getTrainingWeek).mockResolvedValue({ restWeekdays: [] });
    jest.mocked(getPlannedDays).mockResolvedValue([]);
    jest.mocked(getTrainedDates).mockResolvedValue(new Set());
    const s = await loadPlanningSnapshot();
    expect(getActiveConstraints).toHaveBeenCalledWith('2026-09-24');
    expect(getTrainedDates).toHaveBeenCalledWith('2026-09-24');
    expect(getPlannedDays).toHaveBeenCalledWith('2026-09-24', '2026-10-21');
    expect(s.input.block).toBe(s.advance.block);
    expect(s.input.asOf).toBe('2026-10-08');
  });

  it('builds the same input from the same reads, and a different key when they change', () => {
    const reads = {
      source,
      current,
      constraints: [],
      week: { restWeekdays: [] },
      stored: input.stored,
      trainedDates: new Set<string>(),
    };
    const a = buildPlanningSnapshot(reads, input.slots);
    const b = buildPlanningSnapshot(reads, input.slots);
    expect(planningSnapshotKey(a)).toBe(planningSnapshotKey(b));
    expect(a.input.eligibility.excludedIds).toEqual(new Set());
    const c = buildPlanningSnapshot(
      { ...reads, trainedDates: new Set(['2026-10-08']) },
      input.slots,
    );
    expect(planningSnapshotKey(c)).not.toBe(planningSnapshotKey(a));
  });
});
