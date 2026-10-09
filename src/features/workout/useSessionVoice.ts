import { type RefObject, useEffect, useRef } from 'react';

import { isTimed, usesBand, usesDumbbell } from '@/domain/session/setEntry';
import type { Exercise } from '@/domain/types';
import type { VoiceActionId, VoiceCommand } from '@/domain/voice/commands';
import type { VoiceFeedback } from '@/features/voice/VoiceBar';
import { pl } from '@/strings/pl';

import type { SetLoggerHandle } from './SetLogger';
import type { WarmupHandle } from './WarmupChecklist';
import type { useActiveSession } from './useActiveSession';

type Session = ReturnType<typeof useActiveSession>;

interface Options {
  session: Session;
  /** The set screen, while it is on. */
  logger: RefObject<SetLoggerHandle | null>;
  /** The warm-up, while it is on. */
  warmup: RefObject<WarmupHandle | null>;
  /** The exercise on the set screen; a timed one has a stopwatch. */
  exercise: Exercise | undefined;
  stopwatchRunning: boolean;
  /** Skipping the last exercise ends the workout: the same question as "Zakończ trening". */
  confirmFinish: () => void;
}

/** What each screen of the session lets a voice command do. */
export function availableActions(
  phase: Session['phase'],
  timed: boolean,
  stopwatchRunning: boolean,
  exercise?: Exercise,
): VoiceActionId[] {
  switch (phase) {
    case 'warmup':
      return ['warmup_next', 'warmup_finish'];
    case 'logging':
      return [
        ...(timed ? [stopwatchRunning ? 'stopwatch_stop' : ('stopwatch_start' as const)] : []),
        'set_done',
        'skip_exercise',
        ...(timed ? (stopwatchRunning ? [] : ['set_time']) : ['set_reps']),
        'set_effort',
        ...(exercise && usesDumbbell(exercise) ? ['set_weight'] : []),
        ...(exercise && usesBand(exercise) ? ['set_band', 'set_position'] : []),
      ] as VoiceActionId[];
    case 'resting':
      return ['rest_end', 'rest_extend', 'skip_exercise'];
    case 'groupDone':
      return ['rest_end', 'skip_exercise'];
    default:
      return [];
  }
}

/**
 * Voice commands on the session screen. Every command does what its button
 * does, and comes back with a line saying so and a way to take it back:
 * a saved set is taken back like "Cofnij serię", a rest cut short comes
 * back with the time it had, a skip reopens the exercise.
 */
export function useSessionVoice({
  session,
  logger,
  warmup,
  exercise,
  stopwatchRunning,
  confirmFinish,
}: Options) {
  // "Cofnij" runs later, after the session has moved on: it must act on the
  // session as it is then, not as it was when the command ran.
  const latest = useRef(session);
  useEffect(() => {
    latest.current = session;
  });

  const available = availableActions(
    session.phase,
    exercise !== undefined && isTimed(exercise),
    stopwatchRunning,
    exercise,
  );
  const t = pl.voice.done;

  function run(command: VoiceCommand): VoiceFeedback | null {
    if (!available.includes(command.action)) return null;
    switch (command.action) {
      case 'set_reps':
      case 'set_time':
      case 'set_weight':
      case 'set_band':
      case 'set_position':
      case 'set_effort':
        return logger.current?.setParameter(command) ?? null;
      case 'stopwatch_start':
        if (!logger.current?.startStopwatch()) return null;
        return { text: t.stopwatchStart, undo: () => logger.current?.revertStopwatch() };
      case 'stopwatch_stop': {
        const seconds = logger.current?.stopStopwatch() ?? null;
        if (seconds === null) return null;
        return { text: t.stopwatchStop(seconds), undo: () => logger.current?.revertStopwatch() };
      }
      case 'set_done': {
        const text = logger.current?.save() ?? null;
        if (text === null) return null;
        return { text, undo: () => latest.current.undo() };
      }
      case 'rest_end': {
        const ended = session.endRest();
        if (!ended) return null;
        return { text: t.restEnd, undo: () => latest.current.resumeRest(ended) };
      }
      case 'rest_extend':
        if (!session.extendRest(command.seconds)) return null;
        return {
          text: t.restExtend(command.seconds),
          undo: () => latest.current.extendRest(-command.seconds),
        };
      case 'warmup_next': {
        const step = warmup.current?.next();
        if (!step) return null;
        if (step.kind === 'finished') {
          return { text: t.warmupFinish, undo: () => latest.current.backToWarmup() };
        }
        return {
          text: t.warmupNext(pl.workout.warmup.moves[step.id].name),
          undo: () => warmup.current?.untick(step),
        };
      }
      case 'warmup_finish':
        session.warmupDone();
        return { text: t.warmupFinish, undo: () => latest.current.backToWarmup() };
      case 'skip_exercise': {
        const outcome = session.skipExercise();
        if (outcome.kind === 'last') {
          confirmFinish();
          return { text: pl.workout.session.finishConfirmTitle };
        }
        if (outcome.kind === 'none') return null;
        return {
          text: t.skipped(outcome.name),
          undo: () => latest.current.unskip(outcome),
        };
      }
    }
  }

  return { available, run };
}
