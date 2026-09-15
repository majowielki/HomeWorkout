import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Stepper } from '@/components/ui/stepper';
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
    <View className="flex-1 justify-center p-4">
      <Card>
        <CardTitle>{pl.workout.session.warmupTitle}</CardTitle>
        <CardDescription>{pl.workout.session.warmupDescription}</CardDescription>
        {saddleHeightCm ? (
          <CardDescription>{pl.workout.session.saddleHeight(saddleHeightCm)}</CardDescription>
        ) : null}
        <CardContent className="mt-2 items-center gap-4">
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
