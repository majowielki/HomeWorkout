import { randomUUID } from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { getSet } from '@/db/repositories/setLogs';
import { undoSet, updateSet } from '@/db/repositories/sessions';
import { isDone } from '@/domain/commands/result';
import type { SetObservation } from '@/domain/observations/types';
import { correctionOf, resultValues, type SetFieldValues } from '@/domain/session/setEntry';
import type { Exercise } from '@/domain/types';
import { useBandCalibrations } from '@/features/bands/useBandCalibrations';
import { describeResult } from '@/features/history/describeSet';
import { SetFields } from '@/features/workout/SetFields';
import { useExerciseMap } from '@/features/workout/useExerciseMap';
import { pl } from '@/strings/pl';

export default function EditSetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const exerciseMap = useExerciseMap();
  // Read once: the form is made from the set as it was when the screen opened.
  const [row] = useState(() => getSet(id));
  const exercise = row?.observation ? exerciseMap[row.exerciseId] : undefined;

  if (row === null || !row.observation) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: pl.history.setEdit.title }} />
        <Text variant="muted">{pl.history.setEdit.notFound}</Text>
      </View>
    );
  }

  if (!exercise) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: pl.history.setEdit.title }} />
        <ActivityIndicator />
      </View>
    );
  }

  // Keyed on the row so the form's initial state is derived exactly once
  // per set — the same remount-instead-of-effect approach as SetLogger.
  return (
    <EditSetForm
      key={row.id}
      rowId={row.id}
      sessionId={row.workoutId}
      revision={row.revision}
      setIndex={row.setIndex}
      result={row.observation}
      exercise={exercise}
    />
  );
}

function EditSetForm({
  rowId,
  sessionId,
  revision,
  setIndex,
  result,
  exercise,
}: {
  rowId: string;
  sessionId: string;
  revision: number;
  setIndex: number;
  result: SetObservation;
  exercise: Exercise;
}) {
  const router = useRouter();
  const calibrations = useBandCalibrations();
  const [values, setValues] = useState<SetFieldValues>(() => resultValues(exercise, result));
  const [busy, setBusy] = useState(false);

  function handleSave() {
    if (busy) return;
    setBusy(true);
    try {
      const patch = correctionOf(exercise, result, values, new Date().toISOString());
      if (Object.keys(patch).length > 0) {
        const done = updateSet({
          commandId: randomUUID(),
          sessionId,
          observationId: rowId,
          expectedObservationRevision: revision,
          patch,
        });
        if (!isDone(done)) {
          console.warn('could not correct the set', done);
          Alert.alert(pl.common.error);
          return;
        }
      }
      router.back();
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert(pl.history.setEdit.deleteTitle, pl.history.setEdit.deleteBody, [
      { text: pl.common.cancel, style: 'cancel' },
      {
        text: pl.history.detail.delete,
        style: 'destructive',
        onPress: () => {
          if (busy) return;
          setBusy(true);
          try {
            const done = undoSet({
              commandId: randomUUID(),
              sessionId,
              observationId: rowId,
            });
            if (!isDone(done)) {
              console.warn('could not delete the set', done);
              Alert.alert(pl.common.error);
              return;
            }
            router.back();
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-5 pb-12 pt-4">
      <Stack.Screen options={{ title: pl.history.setEdit.title }} />

      <View>
        <Text variant="heading">{exercise.name}</Text>
        <Text variant="muted">
          {pl.history.setEdit.setNumber(setIndex)} · {describeResult(result)}
        </Text>
      </View>

      <SetFields
        exercise={exercise}
        values={values}
        onChange={setValues}
        calibrations={calibrations}
        shortfall="optional"
      />

      <Button label={pl.history.setEdit.save} size="lg" onPress={handleSave} disabled={busy} />
      <Button
        label={pl.history.setEdit.delete}
        variant="outline"
        onPress={confirmDelete}
        disabled={busy}
        labelClassName="text-destructive"
      />
    </ScrollView>
  );
}
