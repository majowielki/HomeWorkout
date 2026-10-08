import { proposalSnapshot } from '@/features/coach/chat/__tests__/proposalFixtures';
import { WEEK_CONFIG } from '@/domain/config/training';
import { type ComputeDeps, computeToday } from '../computeToday';
import type { PlanningSnapshot } from '../planningSnapshot';

jest.mock('@/db/repositories/plannerSource', () => ({}));
jest.mock('@/db/repositories/profile', () => ({}));
jest.mock('@/db/repositories/trainingBlocks', () => ({}));
jest.mock('@/db/repositories/weekPlan', () => ({}));

function deps(snapshot: PlanningSnapshot): ComputeDeps {
  return {
    snapshot: jest.fn().mockResolvedValue(snapshot),
    saveBlockAdvance: jest
      .fn()
      .mockResolvedValue({ id: 'saved-block', state: snapshot.advance.block }),
    saveWeek: jest.fn().mockResolvedValue(undefined),
    markDays: jest.fn().mockResolvedValue(undefined),
    refreshForecasts: jest.fn().mockResolvedValue(undefined),
    unseenChanges: jest.fn().mockResolvedValue(null),
  };
}

/** A snapshot with nothing stored yet: the whole horizon is new. */
function fresh(done = false): PlanningSnapshot {
  const s = proposalSnapshot(done);
  return { ...s, input: { ...s.input, stored: [] } };
}

describe('computeToday', () => {
  it('stores a newly planned week, the block and reads the banner', async () => {
    const d = deps(fresh());
    const today = await computeToday({ persist: true }, d);
    expect(d.saveWeek).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'horizon', fromDate: '2026-10-08' }),
    );
    expect(jest.mocked(d.saveWeek).mock.calls[0]![0].rows).toHaveLength(WEEK_CONFIG.horizonDays);
    expect(d.markDays).not.toHaveBeenCalled();
    expect(d.unseenChanges).toHaveBeenCalled();
    expect(today).toMatchObject({ asOf: '2026-10-08', blockId: 'saved-block', done: false });
    expect(today.plan?.date).toBe('2026-10-08');
    expect(today.tomorrow).toBeNull();
  });

  it('only marks days and refreshes forecasts when the stored week still holds', async () => {
    const d = deps(proposalSnapshot());
    await computeToday({ persist: true }, d);
    expect(d.saveWeek).not.toHaveBeenCalled();
    expect(d.markDays).toHaveBeenCalledWith([]);
    expect(d.refreshForecasts).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ date: '2026-10-08' })]),
    );
  });

  it('plans from scratch on an explicit request', async () => {
    const d = deps(proposalSnapshot());
    await computeToday({ persist: true, request: { trigger: 'manual' } }, d);
    expect(d.saveWeek).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'manual' }));
  });

  it('writes nothing for the chat, and keeps the stored block id', async () => {
    const d = deps(fresh());
    const today = await computeToday({ persist: false }, d);
    expect(d.saveBlockAdvance).not.toHaveBeenCalled();
    expect(d.saveWeek).not.toHaveBeenCalled();
    expect(d.markDays).not.toHaveBeenCalled();
    expect(d.unseenChanges).not.toHaveBeenCalled();
    expect(today).toMatchObject({ blockId: 'block', banner: null });
  });

  it('closes a trained day and shows the next one', async () => {
    const d = deps(fresh(true));
    const today = await computeToday({ persist: false }, d);
    expect(today).toMatchObject({ done: true, plan: null, rest: false });
    expect(today.tomorrow?.date).toBe('2026-10-09');
  });

  it('runs one computation after the other', async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = deps(fresh());
    jest.mocked(first.saveWeek).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            order.push('first saved');
            resolve();
          };
        }),
    );
    const second = deps(fresh());
    jest.mocked(second.snapshot).mockImplementation(async () => {
      order.push('second read');
      return fresh();
    });
    const a = computeToday({ persist: true }, first);
    const b = computeToday({ persist: true }, second);
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual([]);
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(['first saved', 'second read']);
  });
});
