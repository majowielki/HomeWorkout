import { world, recipe, perform } from '@/domain/__tests__/sessionChangeFixtures';
import type { ActiveSessionState, SessionChangeSnapshot } from '@/domain/session/types';

import { readCalibrationOffer } from '../calibration';

const mockSource = jest.fn();
jest.mock('@/db/repositories/sessionChangeSource', () => ({
  loadSessionChangeSource: (...args: unknown[]) => mockSource(...args),
}));
jest.mock('@/db/repositories/sessionChanges', () => ({}));

const FIRST = {
  schemaVersion: 1 as const,
  decision: 'start' as const,
  code: 'FIRST_COMPARABLE_EXPOSURE' as const,
  policy: { id: 'reps_then_resistance', version: '2' },
  evidence: {},
  estimate: null,
};

/** A session whose first set was done as `done` says: the amount and the effort given. */
function after(done: { reps: number; rir: number }, patch: Parameters<typeof recipe>[2] = {}) {
  const { snap, session } = world([recipe('db-floor-press', 3, { trace: FIRST, ...patch })]);
  const records = perform(session, 1);
  const set = records[0]!.sets[0]!;
  const observation = set.observation!;
  records[0]!.sets[0] = {
    ...set,
    observation: {
      ...observation,
      amount: { ...observation.amount, value: { kind: 'reps', reps: done.reps } },
      rir: { ...observation.rir, value: done.rir },
    },
  };
  const state: ActiveSessionState = { ...session, records };
  mockSource.mockReturnValue({ snap, session: state, problems: [] });
  return { snap: snap as SessionChangeSnapshot, session: state, setId: set.planned.id };
}

beforeEach(() => mockSource.mockReset());

describe('the calibration of a new exercise inside the session', () => {
  it('offers the sets that remain one step up after a set that came out far too easy', () => {
    const { setId, session } = after({ reps: 15, rir: 4 });
    const offer = readCalibrationOffer('s1', setId, {});
    expect(offer).toMatchObject({ direction: 'up', remaining: 2, plannedSetId: setId });
    expect(offer!.command).toMatchObject({
      sessionId: 's1',
      change: {
        kind: 'reduce_remaining',
        exposureId: session.plan.exposures[0]!.id,
        harder: true,
        calibrate: true,
      },
      expected: { planRevision: 1, historyRevision: 7 },
      acknowledged: [],
      channel: 'touch',
    });
  });

  it('offers one step down after a set far under the range that was given everything', () => {
    const { setId } = after({ reps: 3, rir: 0 });
    expect(readCalibrationOffer('s1', setId, {})).toMatchObject({
      direction: 'down',
      remaining: 2,
    });
  });

  it('offers nothing for a set that was in the range', () => {
    const { setId } = after({ reps: 10, rir: 2 });
    expect(readCalibrationOffer('s1', setId, {})).toBeNull();
  });

  it('offers nothing for an exercise the person already knows', () => {
    const { setId } = after({ reps: 15, rir: 4 }, { trace: { ...FIRST, code: 'REP_PROGRESSION' } });
    expect(readCalibrationOffer('s1', setId, {})).toBeNull();
  });

  it('stops at two steps, and after a no', () => {
    const { setId, session } = after({ reps: 15, rir: 4 });
    const key = session.plan.exposures[0]!.comparisonKey;
    expect(
      readCalibrationOffer('s1', setId, { [key]: { stepsUp: 2, stepsDown: 0, declined: false } }),
    ).toBeNull();
    expect(
      readCalibrationOffer('s1', setId, { [key]: { stepsUp: 0, stepsDown: 0, declined: true } }),
    ).toBeNull();
  });

  it('offers nothing when no set remains, or the session cannot be read', () => {
    const { snap, session } = world([recipe('db-floor-press', 1, { trace: FIRST })]);
    mockSource.mockReturnValue({
      snap,
      session: { ...session, records: perform(session) },
      problems: [],
    });
    expect(readCalibrationOffer('s1', session.plan.exposures[0]!.sets[0]!.id, {})).toBeNull();
    mockSource.mockReturnValue(null);
    expect(readCalibrationOffer('s1', 'x', {})).toBeNull();
    mockSource.mockReturnValue({ snap, session, problems: [{ code: 'UNKNOWN_SESSION' }] });
    expect(readCalibrationOffer('s1', 'x', {})).toBeNull();
  });

  it('offers nothing where there is no step to take', () => {
    const { snap, session } = world([recipe('crunch', 3, { trace: FIRST })]);
    const records = perform(session, 1);
    const set = records[0]!.sets[0]!;
    records[0]!.sets[0] = {
      ...set,
      observation: {
        ...set.observation!,
        amount: { ...set.observation!.amount, value: { kind: 'reps', reps: 15 } },
        rir: { ...set.observation!.rir, value: 4 },
      },
    };
    mockSource.mockReturnValue({ snap, session: { ...session, records }, problems: [] });
    expect(readCalibrationOffer('s1', set.planned.id, {})).toBeNull();
  });
});
