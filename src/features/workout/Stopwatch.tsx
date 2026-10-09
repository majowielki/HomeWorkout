import * as Haptics from 'expo-haptics';
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';
import { pl } from '@/strings/pl';

/** What a voice command can do to the stopwatch; the same as its button. */
export interface StopwatchHandle {
  /** Starts from zero. False when it was already running. */
  start(): boolean;
  /** The whole seconds held, or null when it was not running. */
  stop(): number | null;
  /** Takes the last start or stop back: a start resets, a stop runs on from where it was. */
  revert(): void;
  isRunning(): boolean;
}

type Props = {
  /** The planned hold; a buzz and a note when it is reached, the clock keeps going. */
  targetSec?: number;
  /** Whole seconds held, on Stop. */
  onStop: (seconds: number) => void;
  /** Running or not, for whoever offers "start" and "stop" by voice. */
  onRunningChange?: (running: boolean) => void;
  ref?: Ref<StopwatchHandle>;
};

function format(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Counts a timed set up from zero, so the logged time is what was held
 * rather than a guess typed afterwards. Like the rest timer it recomputes
 * from a start timestamp on every tick, so a backgrounded app cannot make
 * it drift.
 */
export function Stopwatch({ targetSec, onStop, onRunningChange, ref }: Props) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const buzzed = useRef(false);
  // The state before the last start or stop, for a voice command taken back.
  const before = useRef<{ startedAt: number | null; elapsedMs: number } | null>(null);
  const reached = targetSec !== undefined && elapsedMs >= targetSec * 1000;
  const running = startedAt !== null;

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    return () => clearInterval(id);
  }, [startedAt]);

  useEffect(() => {
    if (startedAt !== null && reached && !buzzed.current) {
      buzzed.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [startedAt, reached]);

  useEffect(() => {
    onRunningChange?.(running);
    // A stopwatch that goes away (the set was saved) is not running any more.
    return () => onRunningChange?.(false);
  }, [running, onRunningChange]);

  function start(): boolean {
    if (startedAt !== null) return false;
    before.current = { startedAt, elapsedMs };
    buzzed.current = false;
    setElapsedMs(0);
    setStartedAt(Date.now());
    return true;
  }

  function stop(): number | null {
    if (startedAt === null) return null;
    before.current = { startedAt, elapsedMs };
    const ms = Date.now() - startedAt;
    setStartedAt(null);
    setElapsedMs(ms);
    const seconds = Math.max(1, Math.round(ms / 1000));
    onStop(seconds);
    return seconds;
  }

  useImperativeHandle(ref, () => ({
    start,
    stop,
    isRunning: () => running,
    revert() {
      const previous = before.current;
      if (!previous) return;
      before.current = null;
      setStartedAt(previous.startedAt);
      setElapsedMs(
        previous.startedAt === null ? previous.elapsedMs : Date.now() - previous.startedAt,
      );
    },
  }));

  const s = pl.workout.session.stopwatch;

  return (
    <View className="items-center gap-3 rounded-3xl bg-secondary p-5">
      <Text
        variant="metric"
        accessibilityRole="timer"
        className={cn('text-6xl leading-[72px]', reached && 'text-highlight')}
      >
        {format(elapsedMs)}
      </Text>
      <Text variant="muted" className="text-center text-xs">
        {running && reached ? s.targetReached : s.hint}
      </Text>
      <Button
        size="lg"
        className="w-full"
        variant={running ? 'inverse' : 'default'}
        label={running ? s.stop : elapsedMs > 0 ? s.again : s.start}
        onPress={() => {
          if (running) stop();
          else start();
        }}
      />
    </View>
  );
}
