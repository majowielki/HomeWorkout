import { recordMildSoreness } from '@/db/repositories/dailyLogs';
import { getDayBoundaryHour } from '@/db/repositories/profile';
import { addConstraint, revokeConstraints } from '@/db/repositories/weekPlan';
import { emptyReport, type SorenessReport } from '@/domain/plan/sorenessReport';
import { computeToday } from '@/features/plan/computeToday';
import { ReportDateChangedError, saveSorenessReport, withdrawSorenessReport } from '../actions';

jest.mock('@/db/repositories/dailyLogs', () => ({ recordMildSoreness: jest.fn() }));
jest.mock('@/db/repositories/profile', () => ({ getDayBoundaryHour: jest.fn() }));
jest.mock('@/db/repositories/weekPlan', () => ({
  addConstraint: jest.fn(),
  revokeConstraints: jest.fn(),
}));
jest.mock('@/features/plan/computeToday', () => ({ computeToday: jest.fn() }));
const NOW = new Date(2026, 9, 7, 12);
const ready = (patch: Partial<SorenessReport> = {}): SorenessReport => ({
  ...emptyReport(),
  kind: 'strong_doms',
  muscles: ['shoulders'],
  redFlags: false,
  ...patch,
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getDayBoundaryHour).mockResolvedValue(4);
  jest.mocked(computeToday).mockResolvedValue({} as Awaited<ReturnType<typeof computeToday>>);
});
it('records mild DOMS in the diary, creates no exclusion and refreshes the plan', async () => {
  const result = await saveSorenessReport(ready({ kind: 'mild_doms' }), '2026-10-07', NOW);
  expect(recordMildSoreness).toHaveBeenCalledWith('2026-10-07', ['shoulders'], NOW);
  expect(addConstraint).not.toHaveBeenCalled();
  expect(computeToday).toHaveBeenCalledWith({
    persist: true,
    request: { trigger: 'constraint', from: '2026-10-07' },
  });
  expect(result.planUpdated).toBe(true);
});
it('stores strong DOMS for two dates inclusive, without writing DOMS 4 into the diary', async () => {
  await saveSorenessReport(ready(), '2026-10-07', NOW);
  expect(addConstraint).toHaveBeenCalledWith(
    expect.objectContaining({
      reason: 'doms',
      muscles: ['shoulders'],
      from: '2026-10-07',
      until: '2026-10-08',
    }),
    NOW,
  );
  expect(recordMildSoreness).not.toHaveBeenCalled();
});
it('uses a pain exclusion for three days, even if the answers resemble DOMS', async () => {
  await saveSorenessReport(
    ready({
      kind: 'muscle_pain',
      days: 3,
      pain: { onset: 'delayed', location: 'diffuse', movement: 'better' },
    }),
    '2026-10-07',
    NOW,
  );
  expect(addConstraint).toHaveBeenCalledWith(
    expect.objectContaining({ reason: 'pain', until: '2026-10-09' }),
    NOW,
  );
});
it.each([ready({ redFlags: true }), ready({ kind: 'joint_pain' }), emptyReport()])(
  'refuses unsafe or incomplete writes (%j)',
  async (report) => {
    await expect(saveSorenessReport(report, '2026-10-07', NOW)).rejects.toThrow(
      'Report is not ready',
    );
    expect(recordMildSoreness).not.toHaveBeenCalled();
    expect(addConstraint).not.toHaveBeenCalled();
    expect(computeToday).not.toHaveBeenCalled();
  },
);
it('requires reviewing new dates after the training-day boundary passes', async () => {
  await expect(saveSorenessReport(ready(), '2026-10-06', NOW)).rejects.toBeInstanceOf(
    ReportDateChangedError,
  );
  expect(addConstraint).not.toHaveBeenCalled();
});
it('uses the previous training date after midnight, before the configured boundary', async () => {
  await saveSorenessReport(ready(), '2026-10-06', new Date(2026, 9, 7, 1));
  expect(addConstraint).toHaveBeenCalledWith(
    expect.objectContaining({ from: '2026-10-06', until: '2026-10-07' }),
    expect.any(Date),
  );
});
it('does not recalculate when storage fails', async () => {
  jest.mocked(addConstraint).mockRejectedValueOnce(new Error('sqlite failure'));
  await expect(saveSorenessReport(ready(), '2026-10-07', NOW)).rejects.toThrow('sqlite failure');
  expect(computeToday).not.toHaveBeenCalled();
});
it('distinguishes a saved report from a failed replan, so it is not submitted twice', async () => {
  jest.mocked(computeToday).mockRejectedValueOnce(new Error('plan failure'));
  expect((await saveSorenessReport(ready(), '2026-10-07', NOW)).planUpdated).toBe(false);
  expect(addConstraint).toHaveBeenCalledTimes(1);
});
it('withdraws only the selected report and replans, without clearing the diary', async () => {
  expect(await withdrawSorenessReport('report', '2026-10-07')).toEqual({ planUpdated: true });
  expect(revokeConstraints).toHaveBeenCalledWith(['report']);
  expect(recordMildSoreness).not.toHaveBeenCalled();
  expect(computeToday).toHaveBeenCalledWith({
    persist: true,
    request: { trigger: 'constraint', from: '2026-10-07' },
  });
});
it('preserves a withdrawal when only replanning fails', async () => {
  jest.mocked(computeToday).mockRejectedValueOnce(new Error('plan failure'));
  expect(await withdrawSorenessReport('report', '2026-10-07')).toEqual({ planUpdated: false });
  expect(revokeConstraints).toHaveBeenCalledTimes(1);
});
