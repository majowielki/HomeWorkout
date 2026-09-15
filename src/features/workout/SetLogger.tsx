import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { getLastSetForExercise } from '@/db/repositories/setLogs';
import { BANDS } from '@/domain/inventory';
import type { AnchorPosition, Exercise, TemplateBlock } from '@/domain/types';
import { pl } from '@/strings/pl';

import {
  ladderFor,
  type SavedSetData,
  SetFields,
  type SetFieldValues,
  toSavedSet,
} from './SetFields';

export type { SavedSetData } from './SetFields';

export interface PrefillData {
  reps: number | null;
  timeSec: number | null;
  rir: number | null;
  weightKg: number | null;
  bandId: string | null;
  anchorPosition: AnchorPosition | null;
}

type Props = {
  exercise: Exercise;
  block: TemplateBlock;
  setNumber: number;
  totalSets: number;
  onSave: (data: SavedSetData) => void;
  saving?: boolean;
};

/**
 * Fetches the previous log for this exercise before rendering the fields.
 *
 * This owns its own loading state rather than accepting `prefill` as a
 * prop that a parent resets on exercise change — resetting state
 * synchronously inside an effect is exactly what the render-purity lint
 * rejects. Because the caller mounts a fresh `<SetLogger key={exerciseId}>`
 * per step, this component's initial `undefined` already *is* the reset;
 * nothing needs to synchronously clear a stale value.
 */
export function SetLogger(props: Props) {
  const [prefill, setPrefill] = useState<PrefillData | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getLastSetForExercise(props.exercise.id).then((row) => {
      if (cancelled) return;
      setPrefill(
        row
          ? {
              reps: row.reps,
              timeSec: row.timeSec,
              rir: row.rir,
              weightKg: row.weightKg,
              bandId: row.bandId,
              anchorPosition: row.anchorPosition,
            }
          : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [props.exercise.id]);

  if (prefill === undefined) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  return <SetLoggerFields {...props} prefill={prefill} />;
}

function SetLoggerFields({
  exercise,
  block,
  setNumber,
  totalSets,
  prefill,
  onSave,
  saving,
}: Props & { prefill: PrefillData | null }) {
  const [values, setValues] = useState<SetFieldValues>(() => ({
    reps: prefill?.reps ?? block.repMin ?? 10,
    timeSec: prefill?.timeSec ?? block.timeSec ?? 30,
    rir: prefill?.rir ?? block.targetRirMin,
    weightKg: prefill?.weightKg ?? ladderFor(exercise)[0]!,
    bandId: prefill?.bandId ?? BANDS[0]!.id,
    position: prefill?.anchorPosition ?? 1,
  }));

  const handleSave = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave(toSavedSet(exercise, values));
  };

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-5 p-4">
      <View>
        <Text variant="heading">
          {block.label} · {exercise.name}
        </Text>
        <Text variant="muted">
          {pl.workout.session.setOf(setNumber, totalSets)} · {targetLabel(block)} · RIR{' '}
          {block.targetRirMin}
          {block.targetRirMax !== block.targetRirMin ? `–${block.targetRirMax}` : ''}
        </Text>
      </View>

      {exercise.kneeCue ? (
        <View className="rounded-xl bg-secondary p-3">
          <Text className="text-sm">{exercise.kneeCue}</Text>
        </View>
      ) : null}

      <SetFields exercise={exercise} values={values} onChange={setValues} />

      <Button label={pl.workout.session.saveSet} size="lg" onPress={handleSave} disabled={saving} />
    </ScrollView>
  );
}

function targetLabel(block: TemplateBlock): string {
  if (block.timeSec !== undefined) return `cel: ${block.timeSec} s`;
  return `cel: ${block.repMin}–${block.repMax}`;
}
