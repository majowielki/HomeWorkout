import { useState } from 'react';
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ChevronRight, Info } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { rankSubstitutes, substituteCandidates } from '@/domain/exercises/substitute';
import { isEligible, slotByExercise } from '@/domain/plan/eligibility';
import type { Exercise, MedicalProfile } from '@/domain/types';
import { ExerciseVideo } from '@/features/exercises/ExerciseVideo';
import { SLOTS } from '@/features/plan/slots';
import { pl } from '@/strings/pl';

const SLOT_OF = slotByExercise(SLOTS);

export interface SubstituteChoice {
  exercise: Exercise;
  /** Use it for the rest of the block, not only today (planned sessions). */
  forBlock: boolean;
  slotId: string | null;
}

type Props = {
  visible: boolean;
  /** The exercise the plan (or template) put in this step. */
  current: Exercise;
  /** What the step was swapped to this session, if anything; offers the way back. */
  swappedTo?: Exercise | null;
  exerciseMap: Record<string, Exercise>;
  profile: MedicalProfile;
  excludedIds: ReadonlySet<string>;
  /** The session runs the engine's plan: offer "rest of the block" and "never again". */
  planned: boolean;
  onSelect: (choice: SubstituteChoice) => void;
  /** Back to `current`, undoing the swap. */
  onRestore?: () => void;
  onExclude: (exercise: Exercise) => void;
  onClose: () => void;
};

const muscles = (e: Exercise) => e.primaryMuscles.map((m) => pl.labels.muscle[m]).join(', ');

/**
 * Swaps the current step for a replacement: the hand-picked substitutes
 * and the other exercises of the same movement slot, ranked by SPEC §3.4
 * (shared primary muscles first) and filtered by the knee and the person's
 * own list. Nothing below the threshold is offered — a bad substitute is
 * worse than none. A tap opens a preview; only its button swaps.
 */
export function SubstituteModal({
  visible,
  current,
  swappedTo = null,
  exerciseMap,
  profile,
  excludedIds,
  planned,
  onSelect,
  onRestore,
  onExclude,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [forBlock, setForBlock] = useState(true);
  const [preview, setPreview] = useState<Exercise | null>(null);
  const slot = SLOT_OF.get(current.id) ?? null;
  const options = rankSubstitutes(
    current,
    substituteCandidates(current, exerciseMap, slot?.exerciseIds),
    (e) => isEligible(e, { profile, excludedIds }),
  ).filter(({ exercise }) => exercise.id !== swappedTo?.id);
  const excluded = excludedIds.has(current.id);
  const t = pl.workout.session;

  const close = () => {
    setPreview(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <Pressable className="flex-1 bg-black/40" onPress={close}>
        <Pressable
          className="mt-auto rounded-t-[32px] bg-background px-5 pt-3"
          style={{ paddingBottom: 16 + insets.bottom, maxHeight: height * 0.85 }}
          onPress={(e) => e.stopPropagation()}
        >
          {preview ? (
            <Preview
              exercise={preview}
              onBack={() => setPreview(null)}
              onPick={() => {
                setPreview(null);
                onSelect({
                  exercise: preview,
                  forBlock: planned && forBlock,
                  slotId: slot?.id ?? null,
                });
              }}
            />
          ) : (
            <ScrollView contentContainerClassName="pb-2">
              <Text variant="heading" className="mb-1">
                {t.substituteTitle}
              </Text>
              <Text variant="muted" className="mb-3 text-xs">
                {t.substituteHow}
              </Text>

              {swappedTo && onRestore ? (
                <Pressable
                  onPress={() => {
                    setPreview(null);
                    onRestore();
                  }}
                  className="mb-2 rounded-2xl border border-border p-4 active:opacity-60"
                >
                  <Text variant="eyebrow">{t.restorePlanned}</Text>
                  <Text className="mt-1 font-display-semibold text-base">{current.name}</Text>
                  <Text variant="muted" className="text-xs">
                    {muscles(current)}
                  </Text>
                </Pressable>
              ) : null}

              {planned && slot ? (
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

              {options.length === 0 ? (
                <Text variant="muted" className="py-4">
                  {t.noSubstitutes}
                </Text>
              ) : (
                options.map(({ exercise }) => (
                  <Pressable
                    key={exercise.id}
                    onPress={() => setPreview(exercise)}
                    accessibilityHint={t.substitutePreviewHint}
                    className="flex-row items-center gap-3 border-b border-border py-3 active:opacity-60"
                  >
                    <View className="flex-1">
                      <Text className="text-base">{exercise.name}</Text>
                      <Text variant="muted" className="text-xs">
                        {muscles(exercise)}
                      </Text>
                    </View>
                    <ChevronRight size={18} className="text-muted-foreground" />
                  </Pressable>
                ))
              )}

              {planned ? (
                excluded ? (
                  <Text variant="muted" className="py-3 text-sm">
                    {t.excludedDone}
                  </Text>
                ) : (
                  <Pressable
                    onPress={() => onExclude(current)}
                    className="py-3.5 active:opacity-60"
                  >
                    <Text className="text-destructive">{t.excludeCurrent(current.name)}</Text>
                  </Pressable>
                )
              ) : null}
              <Pressable onPress={close} className="items-center py-3.5">
                <Text className="font-display-semibold text-highlight">{pl.common.cancel}</Text>
              </Pressable>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** One candidate up close: the clip, the muscles and how to do it, before committing. */
function Preview({
  exercise,
  onBack,
  onPick,
}: {
  exercise: Exercise;
  onBack: () => void;
  onPick: () => void;
}) {
  const t = pl.workout.session;
  return (
    <ScrollView contentContainerClassName="gap-4 pb-2">
      <Pressable onPress={onBack} hitSlop={8} className="self-start py-1">
        <Text className="font-display-semibold text-highlight">{t.substituteBack}</Text>
      </Pressable>
      <View className="flex-row items-start gap-4">
        <ExerciseVideo
          exerciseId={exercise.id}
          mediaKey={exercise.media}
          name={exercise.name}
          className="aspect-[9/16] w-28"
        />
        <View className="flex-1 gap-2">
          <Text variant="title" className="leading-8">
            {exercise.name}
          </Text>
          <Text variant="muted" className="text-sm">
            {t.substituteMuscles(muscles(exercise))}
          </Text>
        </View>
      </View>
      {exercise.cues.length > 0 ? (
        <View className="gap-1.5">
          {exercise.cues.slice(0, 3).map((cue) => (
            <Text key={cue} className="text-sm leading-5">
              {`• ${cue}`}
            </Text>
          ))}
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
      <Button size="lg" label={t.substitutePick} onPress={onPick} />
    </ScrollView>
  );
}
