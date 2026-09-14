import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useRestTimerStore } from '@/stores/restTimerStore';
import { pl } from '@/strings/pl';

type Props = {
  nextLabel: string | null;
  onDone: () => void;
};

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Remaining time is recomputed from Date.now() vs a fixed end timestamp
 * inside the tick callback, never during render (render must stay pure —
 * React Compiler flags a bare Date.now() call in the render body). A
 * setInterval that instead decremented a counter would drift, and stall
 * entirely while the JS thread is backgrounded; recomputing from the
 * timestamp self-corrects the instant the screen is looked at again.
 * See SPEC §7.2.
 */
export function RestTimer({ nextLabel, onDone }: Props) {
  const { restEndsAt, extend, stop } = useRestTimerStore();
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    // No synchronous setState here on purpose — the render-pure rule flags
    // it even indirectly. The first tick lands up to 250ms after the rest
    // period starts (or is extended), which is imperceptible; the render
    // guard below simply shows nothing until then.
    if (restEndsAt === null) return;
    const id = setInterval(() => setRemainingMs(restEndsAt - Date.now()), 250);
    return () => clearInterval(id);
  }, [restEndsAt]);

  useEffect(() => {
    if (remainingMs !== null && remainingMs <= 0) onDone();
  }, [remainingMs, onDone]);

  if (restEndsAt === null || remainingMs === null) return null;

  return (
    <View className="items-center gap-3 rounded-2xl bg-secondary p-5">
      <Text variant="muted">{pl.workout.session.restLabel}</Text>
      <Text variant="metric" className="text-5xl">
        {formatRemaining(remainingMs)}
      </Text>
      <View className="flex-row gap-2">
        <Button
          variant="outline"
          size="sm"
          label={pl.workout.session.restExtend}
          onPress={() => void extend(30, pl.workout.session.restNotificationBody)}
        />
        <Button
          variant="outline"
          size="sm"
          label={pl.workout.session.restSkip}
          onPress={() => {
            void stop();
            onDone();
          }}
        />
      </View>
      {nextLabel ? (
        <Text variant="muted" className="text-center">
          {pl.workout.session.upNext}: {nextLabel}
        </Text>
      ) : null}
    </View>
  );
}
