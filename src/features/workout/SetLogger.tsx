import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Stepper } from '@/components/ui/stepper';
import { Text } from '@/components/ui/text';
import { getLastSetForExercise } from '@/db/repositories/setLogs';
import { BANDS, LADDER_PAIRED, LADDER_SINGLE, nextRung, previousRung } from '@/domain/inventory';
import type { AnchorPosition, DumbbellMode, Exercise, TemplateBlock } from '@/domain/types';
import { pl } from '@/strings/pl';

export interface SavedSetData {
  reps: number | null;
  timeSec: number | null;
  rir: number;
  weightKg: number | null;
  dumbbellMode: DumbbellMode | null;
  bandId: string | null;
  anchorPosition: AnchorPosition | null;
}

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

const RIR_OPTIONS = [0, 1, 2, 3, 4] as const;
const POSITIONS: AnchorPosition[] = [0, 1, 2, 3];
const REP_STEP = 1;
const TIME_STEP = 5;

const usesDumbbell = (e: Exercise) => e.equipment.includes('dumbbell');
const usesBand = (e: Exercise) => e.equipment.includes('band');
const isTimed = (e: Exercise) => e.forceProfile === 'Isometric';

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
  const ladder = exercise.dumbbellMode === 'single' ? LADDER_SINGLE : LADDER_PAIRED;

  const [reps, setReps] = useState(prefill?.reps ?? block.repMin ?? 10);
  const [timeSec, setTimeSec] = useState(prefill?.timeSec ?? block.timeSec ?? 30);
  const [rir, setRir] = useState(prefill?.rir ?? block.targetRirMin);
  const [weightKg, setWeightKg] = useState(prefill?.weightKg ?? ladder[0]!);
  const [bandId, setBandId] = useState(prefill?.bandId ?? BANDS[0]!.id);
  const [position, setPosition] = useState<AnchorPosition>(prefill?.anchorPosition ?? 1);

  const handleSave = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave({
      reps: isTimed(exercise) ? null : reps,
      timeSec: isTimed(exercise) ? timeSec : null,
      rir,
      weightKg: usesDumbbell(exercise) ? weightKg : null,
      dumbbellMode: usesDumbbell(exercise) ? (exercise.dumbbellMode ?? null) : null,
      bandId: usesBand(exercise) ? bandId : null,
      anchorPosition: usesBand(exercise) ? position : null,
    });
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

      {usesDumbbell(exercise) ? (
        <Stepper
          label={
            exercise.dumbbellMode === 'single'
              ? pl.workout.session.dumbbellSingle
              : pl.workout.session.dumbbellPaired
          }
          value={`${weightKg} kg`}
          onDecrement={() => setWeightKg(previousRung(ladder, weightKg))}
          onIncrement={() => setWeightKg(nextRung(ladder, weightKg))}
          decrementDisabled={weightKg <= ladder[0]!}
          incrementDisabled={weightKg >= ladder[ladder.length - 1]!}
        />
      ) : null}

      {usesBand(exercise) ? (
        <View className="gap-3">
          <View className="gap-1.5">
            <Text variant="muted" className="text-xs uppercase tracking-wide">
              {pl.workout.session.band}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {BANDS.map((b) => (
                <Chip
                  key={b.id}
                  label={b.label}
                  selected={bandId === b.id}
                  onPress={() => setBandId(b.id)}
                />
              ))}
            </View>
          </View>
          <View className="gap-1.5">
            <Text variant="muted" className="text-xs uppercase tracking-wide">
              {pl.workout.session.anchorPosition}
            </Text>
            <View className="flex-row gap-2">
              {POSITIONS.map((p) => (
                <Chip
                  key={p}
                  label={`P${p}`}
                  selected={position === p}
                  onPress={() => setPosition(p)}
                />
              ))}
            </View>
          </View>
        </View>
      ) : null}

      {isTimed(exercise) ? (
        <Stepper
          label={pl.workout.session.time}
          value={`${timeSec} s`}
          onDecrement={() => setTimeSec((t) => Math.max(TIME_STEP, t - TIME_STEP))}
          onIncrement={() => setTimeSec((t) => t + TIME_STEP)}
          decrementDisabled={timeSec <= TIME_STEP}
        />
      ) : (
        <Stepper
          label={pl.workout.session.reps}
          value={String(reps)}
          onDecrement={() => setReps((r) => Math.max(1, r - REP_STEP))}
          onIncrement={() => setReps((r) => r + REP_STEP)}
          decrementDisabled={reps <= 1}
        />
      )}

      <View className="gap-1.5">
        <Text variant="muted" className="text-center text-xs uppercase tracking-wide">
          RIR
        </Text>
        <View className="flex-row justify-center gap-2">
          {RIR_OPTIONS.map((r) => (
            <Chip key={r} label={String(r)} selected={rir === r} onPress={() => setRir(r)} />
          ))}
        </View>
      </View>

      <Button label={pl.workout.session.saveSet} size="lg" onPress={handleSave} disabled={saving} />
    </ScrollView>
  );
}

function targetLabel(block: TemplateBlock): string {
  if (block.timeSec !== undefined) return `cel: ${block.timeSec} s`;
  return `cel: ${block.repMin}–${block.repMax}`;
}
