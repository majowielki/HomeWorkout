import { renderHook } from '@testing-library/react-native';

import { exercise } from '@/domain/__tests__/fixtures';
import { pl } from '@/strings/pl';

import type { SetLoggerHandle } from '../SetLogger';
import type { useActiveSession } from '../useActiveSession';
import { availableActions, useSessionVoice } from '../useSessionVoice';

jest.mock('@/db/repositories/setLogs', () => ({}));

type Session = ReturnType<typeof useActiveSession>;

function fakeSession(overrides: Partial<Session>): Session {
  return {
    phase: 'logging',
    undo: jest.fn(async () => undefined),
    endRest: jest.fn(() => ({ phase: 'resting', index: 0, remainingMs: 40_000 })),
    resumeRest: jest.fn(),
    extendRest: jest.fn(() => true),
    skipExercise: jest.fn(() => ({ kind: 'skipped', blockIndex: 1, name: 'Wiosłowanie' })),
    unskip: jest.fn(),
    ...overrides,
  } as unknown as Session;
}

function fakeLogger(): SetLoggerHandle {
  return {
    save: jest.fn(() => true),
    startStopwatch: jest.fn(() => true),
    stopStopwatch: jest.fn(() => 38),
    revertStopwatch: jest.fn(),
  };
}

async function voice(session: Session, options: { timed?: boolean; running?: boolean } = {}) {
  const logger = { current: fakeLogger() };
  const confirmFinish = jest.fn();
  const { result } = await renderHook(() =>
    useSessionVoice({
      session,
      logger,
      exercise: exercise({ forceProfile: options.timed ? 'Isometric' : 'ConcentricEccentric' }),
      stopwatchRunning: options.running ?? false,
      confirmFinish,
    }),
  );
  return { voice: result.current, logger: logger.current, confirmFinish };
}

describe('availableActions', () => {
  it('offers what each screen has a button for', () => {
    expect(availableActions('logging', false, false)).toEqual(['set_done', 'skip_exercise']);
    expect(availableActions('logging', true, false)).toEqual([
      'stopwatch_start',
      'set_done',
      'skip_exercise',
    ]);
    expect(availableActions('logging', true, true)).toEqual([
      'stopwatch_stop',
      'set_done',
      'skip_exercise',
    ]);
    expect(availableActions('resting', false, false)).toEqual([
      'rest_end',
      'rest_extend',
      'skip_exercise',
    ]);
    expect(availableActions('groupDone', false, false)).toEqual(['rest_end', 'skip_exercise']);
    expect(availableActions('warmup', false, false)).toEqual([]);
  });
});

describe('useSessionVoice', () => {
  it('logs the set and takes it back like "Cofnij serię"', async () => {
    const session = fakeSession({});
    const { voice: v, logger } = await voice(session);
    const done = v.run({ action: 'set_done' });
    expect(logger.save).toHaveBeenCalled();
    expect(done?.text).toBe(pl.voice.done.setDone);
    done?.undo?.();
    expect(session.undo).toHaveBeenCalled();
  });

  it('runs the stopwatch and takes a start or stop back', async () => {
    const { voice: idle, logger } = await voice(fakeSession({}), { timed: true });
    const started = idle.run({ action: 'stopwatch_start' });
    expect(started?.text).toBe(pl.voice.done.stopwatchStart);
    started?.undo?.();
    expect(logger.revertStopwatch).toHaveBeenCalledTimes(1);

    const { voice: running, logger: l2 } = await voice(fakeSession({}), {
      timed: true,
      running: true,
    });
    const stopped = running.run({ action: 'stopwatch_stop' });
    expect(stopped?.text).toBe(pl.voice.done.stopwatchStop(38));
    stopped?.undo?.();
    expect(l2.revertStopwatch).toHaveBeenCalled();
  });

  it('ends a rest and brings it back; extends one and takes the extension back', async () => {
    const session = fakeSession({ phase: 'resting' });
    const { voice: v } = await voice(session);
    const ended = v.run({ action: 'rest_end' });
    expect(ended?.text).toBe(pl.voice.done.restEnd);
    ended?.undo?.();
    expect(session.resumeRest).toHaveBeenCalledWith({
      phase: 'resting',
      index: 0,
      remainingMs: 40_000,
    });

    const extended = v.run({ action: 'rest_extend', seconds: 45 });
    expect(extended?.text).toBe(pl.voice.done.restExtend(45));
    expect(session.extendRest).toHaveBeenCalledWith(45);
    extended?.undo?.();
    expect(session.extendRest).toHaveBeenLastCalledWith(-45);
  });

  it('skips an exercise and reopens it; the last one asks before finishing', async () => {
    const session = fakeSession({ phase: 'resting' });
    const { voice: v } = await voice(session);
    const skipped = v.run({ action: 'skip_exercise' });
    expect(skipped?.text).toBe(pl.voice.done.skipped('Wiosłowanie'));
    skipped?.undo?.();
    expect(session.unskip).toHaveBeenCalledWith(1);

    const last = fakeSession({ skipExercise: jest.fn(() => ({ kind: 'last' as const })) });
    const { voice: lastVoice, confirmFinish } = await voice(last);
    expect(lastVoice.run({ action: 'skip_exercise' })?.undo).toBeUndefined();
    expect(confirmFinish).toHaveBeenCalled();

    const none = fakeSession({ skipExercise: jest.fn(() => ({ kind: 'none' as const })) });
    expect((await voice(none)).voice.run({ action: 'skip_exercise' })).toBeNull();
  });

  it('refuses what the screen does not offer, or could not do', async () => {
    const { voice: v } = await voice(fakeSession({}));
    expect(v.run({ action: 'rest_end' })).toBeNull();
    expect(v.run({ action: 'stopwatch_start' })).toBeNull();

    const resting = fakeSession({
      phase: 'resting',
      endRest: jest.fn(() => null),
      extendRest: jest.fn(() => false),
    });
    const { voice: r } = await voice(resting);
    expect(r.run({ action: 'rest_end' })).toBeNull();
    expect(r.run({ action: 'rest_extend', seconds: 30 })).toBeNull();

    const { voice: timed, logger } = await voice(fakeSession({}), { timed: true, running: true });
    (logger.stopStopwatch as jest.Mock).mockReturnValue(null);
    (logger.save as jest.Mock).mockReturnValue(false);
    expect(timed.run({ action: 'stopwatch_stop' })).toBeNull();
    expect(timed.run({ action: 'set_done' })).toBeNull();

    const { voice: idle, logger: l2 } = await voice(fakeSession({}), { timed: true });
    (l2.startStopwatch as jest.Mock).mockReturnValue(false);
    expect(idle.run({ action: 'stopwatch_start' })).toBeNull();
  });
});
