import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { rankSubstitutes, substituteCandidates } from '@/domain/exercises/substitute';
import { isEligible, slotByExercise } from '@/domain/plan/eligibility';
import type { Exercise, MedicalProfile } from '@/domain/types';
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
  current: Exercise;
  exerciseMap: Record<string, Exercise>;
  profile: MedicalProfile;
  excludedIds: ReadonlySet<string>;
  /** The session runs the engine's plan: offer "rest of the block" and "never again". */
  planned: boolean;
  onSelect: (choice: SubstituteChoice) => void;
  onExclude: (exercise: Exercise) => void;
  onClose: () => void;
};

/**
 * Swaps the current step for a replacement: the hand-picked substitutes
 * and the other exercises of the same movement slot, ranked by SPEC §3.4
 * and filtered by the knee and the person's own list. Nothing below the
 * threshold is offered — a bad substitute is worse than none.
 */
export function SubstituteModal({
  visible,
  current,
  exerciseMap,
  profile,
  excludedIds,
  planned,
  onSelect,
  onExclude,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const [forBlock, setForBlock] = useState(true);
  const slot = SLOT_OF.get(current.id) ?? null;
  const options = rankSubstitutes(
    current,
    substituteCandidates(current, exerciseMap, slot?.exerciseIds),
    (e) => isEligible(e, { profile, excludedIds }),
  );
  const excluded = excludedIds.has(current.id);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <Pressable
          className="mt-auto rounded-t-[32px] bg-background px-5 pb-6 pt-3"
          style={{ paddingBottom: 16 + insets.bottom }}
          onPress={(e) => e.stopPropagation()}
        >
          <Text variant="heading" className="mb-3">
            {pl.workout.session.substituteTitle}
          </Text>
          {planned && slot ? (
            <View className="mb-2 items-start gap-1">
              <Chip
                label={pl.workout.session.substituteForBlock}
                selected={forBlock}
                onPress={() => setForBlock((v) => !v)}
              />
              <Text variant="muted" className="text-xs">
                {forBlock
                  ? pl.workout.session.substituteForBlockHint
                  : pl.workout.session.substituteTodayHint}
              </Text>
            </View>
          ) : null}
          {options.length === 0 ? (
            <Text variant="muted" className="py-4">
              {pl.workout.session.noSubstitutes}
            </Text>
          ) : (
            options.map(({ exercise }) => (
              <Pressable
                key={exercise.id}
                onPress={() =>
                  onSelect({ exercise, forBlock: planned && forBlock, slotId: slot?.id ?? null })
                }
                className="border-b border-border py-3.5 active:opacity-60"
              >
                <Text className="text-base">{exercise.name}</Text>
              </Pressable>
            ))
          )}
          {planned ? (
            excluded ? (
              <Text variant="muted" className="py-3 text-sm">
                {pl.workout.session.excludedDone}
              </Text>
            ) : (
              <Pressable onPress={() => onExclude(current)} className="py-3.5 active:opacity-60">
                <Text className="text-destructive">
                  {pl.workout.session.excludeCurrent(current.name)}
                </Text>
              </Pressable>
            )
          ) : null}
          <Pressable onPress={onClose} className="items-center py-3.5">
            <Text className="font-display-semibold text-highlight">{pl.common.cancel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
