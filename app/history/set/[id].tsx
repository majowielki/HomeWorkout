import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { deleteSet, getSet, type SetLogRow, updateSet } from '@/db/repositories/setLogs';
import { BANDS } from '@/domain/inventory';
import type { Exercise } from '@/domain/types';
import { useBandCalibrations } from '@/features/bands/useBandCalibrations';
import { describeSet } from '@/features/history/describeSet';
import {
  ladderFor,
  SetFields,
  type SetFieldValues,
  toSavedSet,
} from '@/features/workout/SetFields';
import { useExerciseMap } from '@/features/workout/useExerciseMap';
import { pl } from '@/strings/pl';

type State = { kind: 'loading' } | { kind: 'notFound' } | { kind: 'ready'; row: SetLogRow };

export default function EditSetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const exerciseMap = useExerciseMap();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getSet(id).then((row) => {
      if (cancelled) return;
      setState(row ? { kind: 'ready', row } : { kind: 'notFound' });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const exercise = state.kind === 'ready' ? exerciseMap[state.row.exerciseId] : undefined;

  if (state.kind === 'loading' || (state.kind === 'ready' && !exercise)) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: pl.history.setEdit.title }} />
        <ActivityIndicator />
      </View>
    );
  }

  if (state.kind === 'notFound' || !exercise) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: pl.history.setEdit.title }} />
        <Text variant="muted">{pl.history.setEdit.notFound}</Text>
      </View>
    );
  }

  // Keyed on the row so the form's initial state is derived exactly once
  // per set — the same remount-instead-of-effect approach as SetLogger.
  return <EditSetForm key={state.row.id} row={state.row} exercise={exercise} />;
}

function EditSetForm({ row, exercise }: { row: SetLogRow; exercise: Exercise }) {
  const router = useRouter();
  const calibrations = useBandCalibrations();
  const [values, setValues] = useState<SetFieldValues>(() => ({
    reps: row.reps ?? 10,
    timeSec: row.timeSec ?? 30,
    rir: row.rir ?? 2,
    weightKg: row.weightKg ?? ladderFor(exercise)[0]!,
    bandId: row.bandId ?? BANDS[0]!.id,
    position: row.anchorPosition ?? 1,
  }));
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (busy) return;
    setBusy(true);
    try {
      const saved = toSavedSet(exercise, values, calibrations);
      await updateSet(row.id, {
        reps: saved.reps,
        timeSec: saved.timeSec,
        rir: saved.rir,
        weightKg: saved.weightKg,
        dumbbellMode: saved.dumbbellMode,
        bandId: saved.bandId,
        anchorPosition: saved.anchorPosition,
        estimatedLoadKg: saved.estimatedLoadKg,
      });
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
          void (async () => {
            if (busy) return;
            setBusy(true);
            try {
              await deleteSet(row.id);
              router.back();
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 p-4 pb-10">
      <Stack.Screen options={{ title: pl.history.setEdit.title }} />

      <View>
        <Text variant="heading">{exercise.name}</Text>
        <Text variant="muted">
          {pl.history.setEdit.setNumber(row.setIndex)} · {describeSet(row)}
        </Text>
      </View>

      <SetFields
        exercise={exercise}
        values={values}
        onChange={setValues}
        calibrations={calibrations}
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
