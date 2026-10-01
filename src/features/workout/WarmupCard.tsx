import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription } from '@/components/ui/card';
import { IconBadge } from '@/components/ui/icon-badge';
import { Bike, Info } from '@/components/ui/icons';
import { Stepper } from '@/components/ui/stepper';
import { Text } from '@/components/ui/text';
import { pl } from '@/strings/pl';

type Props = {
  defaultMinutes: number;
  /** Shown as a standing cue: saddle height has clinical weight for this knee (PLAN §4.3). */
  saddleHeightCm?: number | null;
  onLog: (minutes: number) => void;
  onSkip: () => void;
  saving?: boolean;
};

/** First screen of a session when the template requests a bike warm-up. */
export function WarmupCard({ defaultMinutes, saddleHeightCm, onLog, onSkip, saving }: Props) {
  const [minutes, setMinutes] = useState(defaultMinutes);

  return (
    <View className="flex-1 justify-center p-5">
      <Card className="gap-2 p-6">
        <IconBadge icon={Bike} tone="accent" size="lg" className="mb-3" />
        <Text variant="title">{pl.workout.session.warmupTitle}</Text>
        <CardDescription>{pl.workout.session.warmupDescription}</CardDescription>
        {saddleHeightCm ? (
          <View className="mt-2 flex-row items-center gap-2 self-start rounded-full bg-secondary px-3 py-1.5">
            <Info size={14} className="text-highlight" />
            <Text className="text-xs text-secondary-foreground">
              {pl.workout.session.saddleHeight(saddleHeightCm)}
            </Text>
          </View>
        ) : null}
        <CardContent className="mt-6 items-center gap-4">
          <Stepper
            label={pl.workout.session.minutes}
            value={String(minutes)}
            onDecrement={() => setMinutes((m) => Math.max(1, m - 1))}
            onIncrement={() => setMinutes((m) => m + 1)}
            decrementDisabled={minutes <= 1}
          />
          <Button
            label={pl.workout.session.warmupLog}
            size="lg"
            className="w-full"
            onPress={() => onLog(minutes)}
            disabled={saving}
          />
          <Button
            label={pl.workout.session.warmupSkip}
            variant="ghost"
            className="w-full"
            onPress={onSkip}
            disabled={saving}
          />
        </CardContent>
      </Card>
    </View>
  );
}
