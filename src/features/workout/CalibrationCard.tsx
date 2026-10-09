import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { loadText } from '@/features/plan/format';
import { pl } from '@/strings/pl';

import type { CalibrationOffer } from './calibration';

type Props = {
  offer: CalibrationOffer;
  onAccept: () => void;
  onDecline: () => void;
};

/**
 * Shown during the rest after a set of a new exercise that came out far too easy or too hard: the sets
 * that remain, one step up or down. One touch takes it; leaving it is not a failure (D24).
 */
export function CalibrationCard({ offer, onAccept, onDecline }: Props) {
  const c = pl.workout.session.calibration;
  const from = loadText(offer.from, offer.exerciseId);
  const to = loadText(offer.to, offer.exerciseId);
  return (
    <Card className="gap-3 p-4">
      <Text className="font-display-semibold text-base">
        {offer.direction === 'up' ? c.upTitle : c.downTitle}
      </Text>
      <Text variant="muted">
        {(offer.direction === 'up' ? c.up : c.down)(offer.remaining, from, to)}
      </Text>
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button size="sm" label={c.accept} onPress={onAccept} />
        </View>
        <View className="flex-1">
          <Button size="sm" variant="outline" label={c.decline} onPress={onDecline} />
        </View>
      </View>
    </Card>
  );
}
