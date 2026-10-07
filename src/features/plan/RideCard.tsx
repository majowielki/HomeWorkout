import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardEyebrow } from '@/components/ui/card';
import { Bike, Check, Info } from '@/components/ui/icons';
import { Stepper } from '@/components/ui/stepper';
import { Text } from '@/components/ui/text';
import { type CardioLogRow, getRidesOn, logCardio } from '@/db/repositories/cardioLogs';
import { getProfile } from '@/db/repositories/profile';
import { BIKE_CONFIG } from '@/domain/config/training';
import type { BikePrescription } from '@/domain/progression/bike';
import { pl } from '@/strings/pl';

type Props = {
  /** The training date the plan is for. */
  asOf: string;
  ride: BikePrescription;
};

type Mode = 'open' | 'logging' | 'later';

const RPE_MAX = 10;

/**
 * Today's bike ride as its own task on "Dziś" (SPEC §7, changed after the
 * first week of use): done whenever suits the day, never in the way of the
 * session. Logging asks for the dial and RPE, which plan the next ride.
 */
export function RideCard({ asOf, ride }: Props) {
  const [rides, setRides] = useState<CardioLogRow[] | null>(null);
  const [saddleCm, setSaddleCm] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('open');
  const [minutes, setMinutes] = useState(ride.minutes);
  const [resistance, setResistance] = useState<number | null>(ride.resistance);
  const [rpe, setRpe] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const t = pl.workout.ride;
  const c = pl.workout.cardio;

  const load = useCallback(async () => {
    const [rows, profile] = await Promise.all([getRidesOn(asOf), getProfile()]);
    setRides(rows);
    setSaddleCm(profile?.saddleHeightCm ?? null);
  }, [asOf]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      await logCardio({
        workoutId: null,
        trainingDate: asOf,
        purpose: 'cardio',
        minutes,
        resistanceLevel: resistance,
        rpe,
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (rides === null) return null;

  const last = rides[rides.length - 1];
  if (last) {
    return (
      <Card className="flex-row items-center gap-3">
        <Check size={18} className="text-highlight" />
        <Text className="flex-1 font-display-semibold">{t.doneLine}</Text>
        <Text variant="muted" className="text-sm">
          {pl.history.rideMeta(last.minutes, last.resistanceLevel, last.rpe)}
        </Text>
      </Card>
    );
  }

  if (mode === 'later') {
    return (
      <Pressable onPress={() => setMode('open')} className="active:opacity-80">
        <Card className="flex-row items-center gap-3">
          <Bike size={18} className="text-muted-foreground" />
          <Text className="flex-1">{t.laterLine(ride.minutes)}</Text>
          <Text className="font-display-semibold text-sm text-highlight">{t.done}</Text>
        </Card>
      </Pressable>
    );
  }

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <CardEyebrow className="mb-0">{t.eyebrow}</CardEyebrow>
        <Bike size={18} className="text-highlight" />
      </View>
      <Text variant="title">{`${t.title} · ${pl.plan.bikeLine(ride.minutes, ride.resistance)}`}</Text>
      {ride.reasons.length > 0 ? (
        <Text variant="muted">{ride.reasons.map((r) => pl.plan.bike[r]).join(' ')}</Text>
      ) : null}
      {saddleCm ? (
        <View className="flex-row items-center gap-2 self-start rounded-full bg-secondary px-3 py-1.5">
          <Info size={14} className="text-highlight" />
          <Text className="text-xs text-secondary-foreground">
            {pl.workout.session.saddleHeight(saddleCm)}
          </Text>
        </View>
      ) : null}

      {mode === 'logging' ? (
        <View className="items-center gap-4 pt-2">
          <Stepper
            label={c.minutes}
            value={String(minutes)}
            onDecrement={() => setMinutes((m) => Math.max(1, m - 1))}
            onIncrement={() => setMinutes((m) => m + 1)}
            decrementDisabled={minutes <= 1}
          />
          <View className="w-full flex-row gap-3">
            <Stepper
              label={c.resistance}
              value={resistance === null ? c.unset : String(resistance)}
              onDecrement={() => setResistance((r) => (r === null || r <= 1 ? null : r - 1))}
              onIncrement={() =>
                setResistance((r) => Math.min(BIKE_CONFIG.resistanceMax, (r ?? 0) + 1))
              }
              decrementDisabled={resistance === null}
              incrementDisabled={resistance !== null && resistance >= BIKE_CONFIG.resistanceMax}
              className="flex-1"
            />
            <Stepper
              label={c.rpe}
              value={rpe === null ? c.unset : String(rpe)}
              onDecrement={() => setRpe((r) => (r === null || r <= 1 ? null : r - 1))}
              onIncrement={() => setRpe((r) => Math.min(RPE_MAX, (r ?? 0) + 1))}
              decrementDisabled={rpe === null}
              incrementDisabled={rpe !== null && rpe >= RPE_MAX}
              className="flex-1"
            />
          </View>
          <View className="w-full flex-row gap-2">
            <Button
              label={pl.common.cancel}
              variant="outline"
              className="flex-1"
              onPress={() => setMode('open')}
              disabled={saving}
            />
            <Button label={t.save} className="flex-1" onPress={handleSave} disabled={saving} />
          </View>
        </View>
      ) : (
        <>
          <Text variant="muted" className="text-xs">
            {t.hint}
          </Text>
          <View className="flex-row gap-2">
            <Button
              label={t.later}
              variant="outline"
              className="flex-1"
              onPress={() => setMode('later')}
            />
            <Button label={t.done} className="flex-1" onPress={() => setMode('logging')} />
          </View>
        </>
      )}
    </Card>
  );
}
