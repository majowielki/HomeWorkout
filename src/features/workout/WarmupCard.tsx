import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription } from '@/components/ui/card';
import { IconBadge } from '@/components/ui/icon-badge';
import { Bike, Info } from '@/components/ui/icons';
import { Stepper } from '@/components/ui/stepper';
import { Text } from '@/components/ui/text';
import { BIKE_CONFIG } from '@/domain/config/training';
import { pl } from '@/strings/pl';

export interface WarmupResult {
  minutes: number;
  /** Only asked for a planned ride (`askEffort`); null otherwise or when left unset. */
  resistance: number | null;
  rpe: number | null;
}

type Props = {
  defaultMinutes: number;
  /** Shown as a standing cue: saddle height has clinical weight for this knee (PLAN §4.3). */
  saddleHeightCm?: number | null;
  /**
   * A planned daily ride (SPEC §7 v1.2): also asks for the dial and how hard
   * it felt, which is what the next ride is planned from.
   */
  askEffort?: boolean;
  defaultResistance?: number | null;
  /** One line on why the ride is this long. */
  note?: string;
  onLog: (result: WarmupResult) => void;
  onSkip: () => void;
  saving?: boolean;
};

const RPE_MAX = 10;

/** First screen of a session: the bike, as a warm-up for a template or the planned daily ride. */
export function WarmupCard({
  defaultMinutes,
  saddleHeightCm,
  askEffort,
  defaultResistance = null,
  note,
  onLog,
  onSkip,
  saving,
}: Props) {
  const [minutes, setMinutes] = useState(defaultMinutes);
  const [resistance, setResistance] = useState<number | null>(defaultResistance);
  const [rpe, setRpe] = useState<number | null>(null);
  const unset = pl.workout.cardio.unset;

  return (
    <View className="flex-1 justify-center p-5">
      <Card className="gap-2 p-6">
        <IconBadge icon={Bike} tone="accent" size="lg" className="mb-3" />
        <Text variant="title">{pl.workout.session.warmupTitle}</Text>
        <CardDescription>
          {askEffort ? pl.workout.session.rideDescription : pl.workout.session.warmupDescription}
        </CardDescription>
        {note ? <Text variant="muted">{note}</Text> : null}
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
          {askEffort ? (
            <>
              <Stepper
                label={pl.workout.cardio.resistance}
                value={resistance === null ? unset : String(resistance)}
                onDecrement={() => setResistance((r) => (r === null || r <= 1 ? null : r - 1))}
                onIncrement={() =>
                  setResistance((r) => Math.min(BIKE_CONFIG.resistanceMax, (r ?? 0) + 1))
                }
                decrementDisabled={resistance === null}
                incrementDisabled={resistance !== null && resistance >= BIKE_CONFIG.resistanceMax}
              />
              <Stepper
                label={pl.workout.cardio.rpe}
                value={rpe === null ? unset : String(rpe)}
                onDecrement={() => setRpe((r) => (r === null || r <= 1 ? null : r - 1))}
                onIncrement={() => setRpe((r) => Math.min(RPE_MAX, (r ?? 0) + 1))}
                decrementDisabled={rpe === null}
                incrementDisabled={rpe !== null && rpe >= RPE_MAX}
              />
            </>
          ) : null}
          <Button
            label={pl.workout.session.warmupLog}
            size="lg"
            className="w-full"
            onPress={() =>
              onLog({
                minutes,
                resistance: askEffort ? resistance : null,
                rpe: askEffort ? rpe : null,
              })
            }
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
