import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { ymoveMedia } from '@/assets/ymove-media';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Info } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { getLastSetForExercise } from '@/db/repositories/setLogs';
import { BANDS } from '@/domain/inventory';
import type { PlannedExercise } from '@/domain/plan/types';
import type { AnchorPosition, BandCalibrationMap, Exercise, TemplateBlock } from '@/domain/types';
import { ExerciseThumb } from '@/features/exercises/ExerciseThumb';
import { ExerciseVideo } from '@/features/exercises/ExerciseVideo';
import { GlossaryButton } from '@/features/glossary/GlossaryButton';
import { cn } from '@/lib/cn';
import { pl } from '@/strings/pl';

import {
  isTimed,
  ladderFor,
  type SavedSetData,
  SetFields,
  type SetFieldValues,
  toSavedSet,
} from './SetFields';
import { Stopwatch } from './Stopwatch';

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
  /**
   * The engine's prescription for this step, when the session runs a plan.
   * Its load and target prefill the first set of the planned exercise; later
   * sets, and a substitute, prefill from the last logged set as before.
   */
  planned?: PlannedExercise;
  /** Start with the warm-up toggle on (bands, SPEC §5.6). */
  defaultWarmup?: boolean;
  setNumber: number;
  totalSets: number;
  onSave: (data: LoggedSetData) => void;
  saving?: boolean;
  calibrations?: BandCalibrationMap;
  /** Opens the exercise's full description; the link only shows next to a clip. */
  onShowDetails?: () => void;
  /** Names of the other exercises in this superset; absent for a lone exercise. */
  supersetWith?: string;
};

/**
 * The first set of a planned exercise starts from the plan; every other
 * set starts from the last one logged for the exercise.
 */
export function SetLogger(props: Props) {
  const fromPlan =
    props.planned !== undefined &&
    props.planned.exerciseId === props.exercise.id &&
    props.setNumber === 1
      ? props.planned
      : null;
  if (fromPlan) return <SetLoggerFields {...props} prefill={plannedPrefill(fromPlan)} />;
  return <SetLoggerFromHistory {...props} />;
}

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
function SetLoggerFromHistory(props: Props) {
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
  defaultWarmup,
  onShowDetails,
  supersetWith,
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
  const warmupAvailable = setNumber === 1;
  const [isWarmup, setIsWarmup] = useState(Boolean(defaultWarmup) && warmupAvailable);

  const handleSave = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave({ ...toSavedSet(exercise, values, calibrations), isWarmup });
  };

  const hasClip = ymoveMedia[exercise.id] !== undefined;

  const heading = (
    <View className="flex-1 gap-1">
      <Text variant="eyebrow" className="text-highlight">
        {block.label} · {pl.workout.session.setOf(setNumber, totalSets)}
      </Text>
      <Text variant="title" className="leading-8">
        {exercise.name}
      </Text>
    </View>
  );

  const targets = (
    <View className="flex-row flex-wrap gap-2">
      <Badge variant="outline" label={targetLabel(block)} />
      <Badge
        variant="outline"
        label={`RIR ${block.targetRirMin}${block.targetRirMax !== block.targetRirMin ? `–${block.targetRirMax}` : ''}`}
      />
    </View>
  );

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-6 pt-4">
      {hasClip ? (
        // The clip is the point of this screen: big enough to read the movement from a metre away.
        <View className="flex-row items-start gap-4">
          <ExerciseVideo
            exerciseId={exercise.id}
            mediaKey={exercise.media}
            name={exercise.name}
            className="aspect-[9/16] w-36"
          />
          <View className="flex-1 gap-3">
            <View className="flex-row items-start">
              {heading}
              <GlossaryButton className="-mr-3 -mt-2" />
            </View>
            {targets}
            {onShowDetails ? (
              <Pressable onPress={onShowDetails} hitSlop={8} accessibilityRole="link">
                <Text className="font-display-semibold text-highlight">
                  {pl.workout.session.exerciseDetails}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : (
        <View className="flex-row items-start gap-4">
          <ExerciseThumb mediaKey={exercise.media} className="h-20 w-20 rounded-2xl" />
          {heading}
          <GlossaryButton className="-mr-3 -mt-2" />
        </View>
      )}

      <View className="flex-row gap-2">
        <SetProgress done={setNumber - 1} total={totalSets} />
      </View>

      {hasClip ? null : targets}

      {supersetWith ? (
        <View className="rounded-2xl border border-border p-4">
          <Text className="text-sm leading-5">{pl.workout.session.supersetWith(supersetWith)}</Text>
        </View>
      ) : null}

      {exercise.kneeCue ? (
        <View className="flex-row gap-3 rounded-2xl bg-secondary p-4">
          <Info size={18} className="mt-0.5 text-highlight" />
          <Text className="flex-1 text-sm leading-5 text-secondary-foreground">
            {exercise.kneeCue}
          </Text>
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

      {isTimed(exercise) ? (
        <Stopwatch
          targetSec={block.timeSec}
          onStop={(seconds) => setValues((v) => ({ ...v, timeSec: seconds }))}
        />
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

/** One segment per set of the block; finished sets filled, the current one outlined. */
function SetProgress({ done, total }: { done: number; total: number }) {
  return (
    <>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          className={cn(
            'h-1.5 flex-1 rounded-full',
            i < done ? 'bg-primary' : i === done ? 'bg-foreground' : 'bg-secondary',
          )}
        />
      ))}
    </>
  );
}

/** The engine's load and first-set target as the logger's starting values. */
function plannedPrefill(p: PlannedExercise): PrefillData {
  return {
    reps: p.unit === 'reps' ? p.target : null,
    timeSec: p.unit === 'sec' ? p.target : null,
    rir: p.targetRirMin,
    weightKg: p.load.kind === 'dumbbell' ? p.load.kg : null,
    bandId: p.load.kind === 'band' ? p.load.bandId : null,
    anchorPosition: p.load.kind === 'band' ? p.load.position : null,
  };
}

function targetLabel(block: TemplateBlock): string {
  if (block.timeSec !== undefined) return pl.workout.session.targetTime(block.timeSec);
  return pl.workout.session.targetReps(block.repMin ?? 0, block.repMax ?? block.repMin ?? 0);
}
