import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useThemeColors } from '@/lib/theme';
import { useRestTimerStore } from '@/stores/restTimerStore';
import { pl } from '@/strings/pl';

type Props = {
  nextLabel: string | null;
  onDone: () => void;
};

const RING_SIZE = 260;
const RING_STROKE = 14;
const RADIUS = (RING_SIZE - RING_STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

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
 *
 * The ring drains from full to empty over the whole rest, extensions
 * included, so "+30 s" visibly refills it.
 */
export function RestTimer({ nextLabel, onDone }: Props) {
  const { restEndsAt, restTotalMs, extend, stop } = useRestTimerStore();
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const colors = useThemeColors();

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

  const fraction = restTotalMs ? Math.min(1, Math.max(0, remainingMs / restTotalMs)) : 1;

  return (
    <View className="items-center gap-8">
      <View style={{ width: RING_SIZE, height: RING_SIZE }}>
        <Svg width={RING_SIZE} height={RING_SIZE}>
          <Circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            stroke={colors.secondary}
            strokeWidth={RING_STROKE}
            fill="none"
          />
          <Circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            stroke={colors.primary}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
            fill="none"
            // Start the arc at 12 o'clock.
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          />
        </Svg>
        <View className="absolute inset-0 items-center justify-center gap-1">
          <Text variant="eyebrow">{pl.workout.session.restLabel}</Text>
          <Text variant="metric" className="text-6xl leading-[72px]">
            {formatRemaining(remainingMs)}
          </Text>
        </View>
      </View>

      <View className="w-full flex-row gap-3">
        <Button
          variant="secondary"
          className="flex-1"
          label={pl.workout.session.restExtend}
          onPress={() => void extend(30, pl.workout.session.restNotificationBody)}
        />
        <Button
          variant="inverse"
          className="flex-1"
          label={pl.workout.session.restSkip}
          onPress={() => {
            void stop();
            onDone();
          }}
        />
      </View>

      {nextLabel ? (
        <View className="w-full gap-1 rounded-3xl bg-secondary p-4">
          <Text variant="eyebrow">{pl.workout.session.upNext}</Text>
          <Text className="font-display-semibold text-base text-secondary-foreground">
            {nextLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
