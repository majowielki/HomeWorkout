import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';
import { pl } from '@/strings/pl';

type Props = {
  /** The planned hold; a buzz and a note when it is reached, the clock keeps going. */
  targetSec?: number;
  /** Whole seconds held, on Stop. */
  onStop: (seconds: number) => void;
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
export function Stopwatch({ targetSec, onStop }: Props) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const buzzed = useRef(false);
  const reached = targetSec !== undefined && elapsedMs >= targetSec * 1000;

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

  const running = startedAt !== null;
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
          if (running) {
            const ms = Date.now() - startedAt;
            setStartedAt(null);
            setElapsedMs(ms);
            onStop(Math.max(1, Math.round(ms / 1000)));
          } else {
            buzzed.current = false;
            setElapsedMs(0);
            setStartedAt(Date.now());
          }
        }}
      />
    </View>
  );
}
