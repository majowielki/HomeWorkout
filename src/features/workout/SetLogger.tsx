import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { getLastSetForExercise } from '@/db/repositories/setLogs';
import { BANDS } from '@/domain/inventory';
import type { AnchorPosition, BandCalibrationMap, Exercise, TemplateBlock } from '@/domain/types';
import { GlossaryButton } from '@/features/glossary/GlossaryButton';
import { pl } from '@/strings/pl';

import {
  ladderFor,
  type SavedSetData,
  SetFields,
  type SetFieldValues,
  toSavedSet,
} from './SetFields';

export type { SavedSetData } from './SetFields';

/** What the active session receives: the set plus whether it was a warm-up. */
export type LoggedSetData = SavedSetData & { isWarmup: boolean };

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
  onSave: (data: LoggedSetData) => void;
  saving?: boolean;
  calibrations?: BandCalibrationMap;
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
  calibrations,
}: Props & { prefill: PrefillData | null }) {
  const [values, setValues] = useState<SetFieldValues>(() => ({
    reps: prefill?.reps ?? block.repMin ?? 10,
    timeSec: prefill?.timeSec ?? block.timeSec ?? 30,
    rir: prefill?.rir ?? block.targetRirMin,
    weightKg: prefill?.weightKg ?? ladderFor(exercise)[0]!,
    bandId: prefill?.bandId ?? BANDS[0]!.id,
    position: prefill?.anchorPosition ?? 1,
  }));
  // A warm-up only makes sense before the first working set of a block —
  // for bands it is what SPEC §5.6 requires (Mullins effect), for the knee
  // it is plain sense. Off by default so the common path stays one tap.
  const [isWarmup, setIsWarmup] = useState(false);
  const warmupAvailable = setNumber === 1;

  const handleSave = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave({ ...toSavedSet(exercise, values, calibrations), isWarmup });
  };

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-5 p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <Text variant="heading">
            {block.label} · {exercise.name}
          </Text>
          <Text variant="muted">
            {pl.workout.session.setOf(setNumber, totalSets)} · {targetLabel(block)} · RIR{' '}
            {block.targetRirMin}
            {block.targetRirMax !== block.targetRirMin ? `–${block.targetRirMax}` : ''}
          </Text>
        </View>
        <GlossaryButton />
      </View>

      {exercise.kneeCue ? (
        <View className="rounded-xl bg-secondary p-3">
          <Text className="text-sm">{exercise.kneeCue}</Text>
        </View>
      ) : null}

      {warmupAvailable ? (
        <View className="items-center gap-1">
          <Chip
            label={pl.workout.session.warmupSet}
            selected={isWarmup}
            onPress={() => setIsWarmup((v) => !v)}
          />
          {isWarmup ? (
            <Text variant="muted" className="text-center text-xs">
              {pl.workout.session.warmupSetHint}
            </Text>
          ) : null}
        </View>
      ) : null}

      <SetFields
        exercise={exercise}
        values={values}
        onChange={setValues}
        calibrations={calibrations}
      />

      <Button
        label={isWarmup ? pl.workout.session.saveWarmupSet : pl.workout.session.saveSet}
        size="lg"
        variant={isWarmup ? 'secondary' : 'default'}
        onPress={handleSave}
        disabled={saving}
      />
    </ScrollView>
  );
}

function targetLabel(block: TemplateBlock): string {
  if (block.timeSec !== undefined) return pl.workout.session.targetTime(block.timeSec);
  return pl.workout.session.targetReps(block.repMin ?? 0, block.repMax ?? block.repMin ?? 0);
}
