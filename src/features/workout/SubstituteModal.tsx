import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, useWindowDimensions, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ChevronRight, Info } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { EquipmentFamily } from '@/domain/catalog/attributes';
import type { PlannedExposure } from '@/domain/plan/plan';
import { assessmentText } from '@/domain/session/assessmentText';
import type { RankedAlternative } from '@/domain/session/types';
import type { Exercise } from '@/domain/types';
import { ExerciseVideo } from '@/features/exercises/ExerciseVideo';
import { useThemeColors } from '@/lib/theme';
import { pl } from '@/strings/pl';

import { adviceOf, type Alternatives, loadAlternatives, swapExercise } from './alternatives';

type Props = {
  visible: boolean;
  sessionId: string;
  /** The exercise of the plan that is to be replaced for the rest of the session. */
  exposure: PlannedExposure;
  current: Exercise;
  exerciseMap: Record<string, Exercise>;
  excludedIds: ReadonlySet<string>;
  /** Only the alternatives that use this kind of equipment ("zamień na coś z gumą"). */
  family?: EquipmentFamily;
  /** The plan now has the other exercise. */
  onSwapped: () => void;
  onExclude: (exercise: Exercise) => void;
  onClose: () => void;
};

type Loaded = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; data: Alternatives };

const muscles = (e: Exercise) => e.primaryMuscles.map((m) => pl.labels.muscle[m]).join(', ');

/**
 * Replaces the exercise on screen for the rest of the session with one the
 * engine ranks: it assesses each candidate against the knee, the week, the
 * time and the person's own list, and prescribes it. Nothing it blocks is
 * offered. A tap opens a preview with what the engine says about it; only the
 * preview's button swaps, and advice against the swap is shown there first.
 *
 * A bottom sheet like "Postęp sesji", so a swipe down closes it too.
 */
export function SubstituteModal({
  visible,
  sessionId,
  exposure,
  current,
  exerciseMap,
  excludedIds,
  family,
  onSwapped,
  onExclude,
  onClose,
}: Props) {
  const { height } = useWindowDimensions();
  const colors = useThemeColors();
  const sheetRef = useRef<BottomSheet>(null);
  const [forBlock, setForBlock] = useState(true);
  const [preview, setPreview] = useState<RankedAlternative | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const excluded = excludedIds.has(current.id);
  const t = pl.workout.session;

  const close = () => {
    setPreview(null);
    setLoaded({ kind: 'loading' });
    onClose();
  };

  // The ranking runs the engine for each candidate: after the sheet has opened, not while it does.
  const reload = useCallback(() => {
    const timer = setTimeout(() => {
      try {
        const data = loadAlternatives(sessionId, exposure, family);
        setLoaded(data === null ? { kind: 'failed' } : { kind: 'ready', data });
      } catch (error) {
        console.warn('could not rank the alternatives', error);
        setLoaded({ kind: 'failed' });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [sessionId, exposure, family]);

  useEffect(() => {
    if (visible) sheetRef.current?.expand();
    else sheetRef.current?.close();
  }, [visible]);

  useEffect(() => (visible ? reload() : undefined), [visible, reload]);

  async function pick(alternative: RankedAlternative, expected: Alternatives['expected']) {
    if (busy) return;
    setBusy(true);
    try {
      const { result, blockSaved } = await swapExercise(
        sessionId,
        exposure,
        alternative,
        expected,
        {
          forBlock: forBlock && exposure.slotId !== null,
          channel: 'touch',
        },
      );
      if (result.kind === 'committed') {
        if (!blockSaved) Alert.alert(t.blockSwapError);
        close();
        onSwapped();
        return;
      }
      console.warn('could not swap the exercise', result);
      Alert.alert(pl.common.error);
      setPreview(null);
      setLoaded({ kind: 'loading' });
      reload();
    } finally {
      setBusy(false);
    }
  }

  // Android's back button closes the sheet before it leaves the workout.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      sheetRef.current?.close();
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
    ),
    [],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      enableDynamicSizing
      maxDynamicContentSize={height * 0.85}
      enablePanDownToClose
      onClose={() => {
        if (visible) close();
      }}
      backdropComponent={renderBackdrop}
      // gorhom takes raw style objects, not classes — hence the JS palette.
      backgroundStyle={{ backgroundColor: colors.background }}
      handleIndicatorStyle={{ backgroundColor: colors.mutedForeground }}
    >
      {preview && loaded.kind === 'ready' ? (
        <Preview
          alternative={preview}
          exercise={exerciseMap[preview.exerciseId]}
          name={(id) => exerciseMap[id]?.name}
          busy={busy}
          onBack={() => setPreview(null)}
          onPick={() => void pick(preview, loaded.data.expected)}
        />
      ) : (
        // gorhom's scroll view takes style objects, not classes.
        <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}>
          <Text variant="heading" className="mb-1">
            {t.substituteTitle}
          </Text>
          <Text variant="muted" className="mb-3 text-xs">
            {t.substituteHow}
          </Text>

          {exposure.slotId !== null ? (
            <View className="mb-2 items-start gap-1">
              <Chip
                label={t.substituteForBlock}
                selected={forBlock}
                onPress={() => setForBlock((v) => !v)}
              />
              <Text variant="muted" className="text-xs">
                {forBlock ? t.substituteForBlockHint : t.substituteTodayHint}
              </Text>
            </View>
          ) : null}

          {loaded.kind === 'loading' ? (
            <Text variant="muted" className="py-4">
              {t.substituteLoading}
            </Text>
          ) : loaded.kind === 'failed' ? (
            <Text variant="muted" className="py-4">
              {t.substituteFailed}
            </Text>
          ) : loaded.data.alternatives.length === 0 ? (
            <Text variant="muted" className="py-4">
              {t.noSubstitutes}
            </Text>
          ) : (
            loaded.data.alternatives.map((alternative) => {
              const exercise = exerciseMap[alternative.exerciseId];
              return (
                <Pressable
                  key={alternative.exerciseId}
                  onPress={() => setPreview(alternative)}
                  accessibilityHint={t.substitutePreviewHint}
                  className="flex-row items-center gap-3 border-b border-border py-3 active:opacity-60"
                >
                  <View className="flex-1">
                    <Text className="text-base">{exercise?.name ?? alternative.exerciseId}</Text>
                    <Text variant="muted" className="text-xs">
                      {[
                        exercise ? muscles(exercise) : null,
                        alternative.verdict === 'not_recommended'
                          ? t.substituteAdvisedAgainst
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <ChevronRight size={18} className="text-muted-foreground" />
                </Pressable>
              );
            })
          )}

          {excluded ? (
            <Text variant="muted" className="py-3 text-sm">
              {t.excludedDone}
            </Text>
          ) : (
            <Pressable onPress={() => onExclude(current)} className="py-3.5 active:opacity-60">
              <Text className="text-destructive">{t.excludeCurrent(current.name)}</Text>
            </Pressable>
          )}
          <Pressable onPress={() => sheetRef.current?.close()} className="items-center py-3.5">
            <Text className="font-display-semibold text-highlight">{pl.common.cancel}</Text>
          </Pressable>
        </BottomSheetScrollView>
      )}
    </BottomSheet>
  );
}

/** One candidate up close: the clip, the muscles, what the engine says and prescribes, before committing. */
function Preview({
  alternative,
  exercise,
  name,
  busy,
  onBack,
  onPick,
}: {
  alternative: RankedAlternative;
  exercise: Exercise | undefined;
  name: (exerciseId: string) => string | undefined;
  busy: boolean;
  onBack: () => void;
  onPick: () => void;
}) {
  const t = pl.workout.session;
  const sentences = assessmentText(
    { ...alternative.assessment, alternatives: [] },
    { exerciseName: name },
  );
  const advised = adviceOf(alternative).length > 0;
  return (
    <BottomSheetScrollView
      contentContainerStyle={{ gap: 16, paddingHorizontal: 20, paddingBottom: 16 }}
    >
      <Pressable onPress={onBack} hitSlop={8} className="self-start py-1">
        <Text className="font-display-semibold text-highlight">{t.substituteBack}</Text>
      </Pressable>
      <View className="flex-row items-start gap-4">
        {exercise ? (
          <ExerciseVideo
            exerciseId={exercise.id}
            mediaKey={exercise.media}
            name={exercise.name}
            className="aspect-[9/16] w-28"
          />
        ) : null}
        <View className="flex-1 gap-2">
          <Text variant="title" className="leading-8">
            {exercise?.name ?? alternative.exerciseId}
          </Text>
          {exercise ? (
            <Text variant="muted" className="text-sm">
              {t.substituteMuscles(muscles(exercise))}
            </Text>
          ) : null}
        </View>
      </View>
      <View className="gap-1.5">
        {sentences.map((line) => (
          <Text key={line} className="text-sm leading-5">
            {line}
          </Text>
        ))}
      </View>
      {exercise && exercise.cues.length > 0 ? (
        <View className="gap-1.5">
          {exercise.cues.slice(0, 3).map((cue) => (
            <Text key={cue} className="text-sm leading-5">
              {`• ${cue}`}
            </Text>
          ))}
        </View>
      ) : null}
      {exercise?.kneeCue ? (
        <View className="flex-row gap-3 rounded-2xl bg-secondary p-4">
          <Info size={18} className="mt-0.5 text-highlight" />
          <Text className="flex-1 text-sm leading-5 text-secondary-foreground">
            {exercise.kneeCue}
          </Text>
        </View>
      ) : null}
      <Button
        size="lg"
        label={advised ? t.substituteAnyway : t.substitutePick}
        onPress={onPick}
        disabled={busy}
      />
    </BottomSheetScrollView>
  );
}
