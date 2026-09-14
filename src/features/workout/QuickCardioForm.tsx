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

/** Standalone bike ride, not attached to any strength session. */
export function QuickCardioForm({ trainingDate, onLogged, onCancel }: Props) {
  const [minutes, setMinutes] = useState(20);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await logCardio({ workoutId: null, trainingDate, purpose: 'cardio', minutes });
    setSaving(false);
    onLogged();
  }

  return (
    <Card>
      <CardTitle>{pl.workout.quickCardio}</CardTitle>
      <CardContent className="items-center gap-4">
        <Stepper
          label={pl.workout.session.minutes}
          value={String(minutes)}
          onDecrement={() => setMinutes((m) => Math.max(5, m - 5))}
          onIncrement={() => setMinutes((m) => m + 5)}
          decrementDisabled={minutes <= 5}
        />
        <View className="w-full flex-row gap-2">
          <Button
            label={pl.common.cancel}
            variant="outline"
            className="flex-1"
            onPress={onCancel}
            disabled={saving}
          />
          <Button
            label={pl.workout.session.saveSet}
            className="flex-1"
            onPress={handleSave}
            disabled={saving}
          />
        </View>
      </CardContent>
    </Card>
  );
}
