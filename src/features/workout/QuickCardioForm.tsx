import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Stepper } from '@/components/ui/stepper';
import { logCardio } from '@/db/repositories/cardioLogs';
import { pl } from '@/strings/pl';

type Props = {
  trainingDate: string;
  onLogged: () => void;
  onCancel: () => void;
};

const MINUTE_STEP = 5;
const RESISTANCE_MAX = 20;
const RPE_MAX = 10;

/**
 * Standalone bike ride, not attached to any strength session. Minutes
 * are required; resistance (this bike's own ordinal dial) and RPE are
 * optional and start unset, so a ride is still one tap to log.
 */
export function QuickCardioForm({ trainingDate, onLogged, onCancel }: Props) {
  const [minutes, setMinutes] = useState(20);
  const [resistance, setResistance] = useState<number | null>(null);
  const [rpe, setRpe] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      await logCardio({
        workoutId: null,
        trainingDate,
        purpose: 'cardio',
        minutes,
        resistanceLevel: resistance,
        rpe,
      });
      onLogged();
    } finally {
      setSaving(false);
    }
  }

  const c = pl.workout.cardio;

  return (
    <Card>
      <CardTitle>{pl.workout.quickCardio}</CardTitle>
      <CardContent className="items-center gap-4">
        <Stepper
          label={c.minutes}
          value={String(minutes)}
          onDecrement={() => setMinutes((m) => Math.max(MINUTE_STEP, m - MINUTE_STEP))}
          onIncrement={() => setMinutes((m) => m + MINUTE_STEP)}
          decrementDisabled={minutes <= MINUTE_STEP}
        />
        <View className="w-full flex-row gap-3">
          <Stepper
            label={c.resistance}
            value={resistance === null ? c.unset : String(resistance)}
            onDecrement={() => setResistance((r) => (r === null || r <= 1 ? null : r - 1))}
            onIncrement={() => setResistance((r) => Math.min(RESISTANCE_MAX, (r ?? 0) + 1))}
            decrementDisabled={resistance === null}
            incrementDisabled={resistance !== null && resistance >= RESISTANCE_MAX}
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
            onPress={onCancel}
            disabled={saving}
          />
          <Button label={c.save} className="flex-1" onPress={handleSave} disabled={saving} />
        </View>
      </CardContent>
    </Card>
  );
}
