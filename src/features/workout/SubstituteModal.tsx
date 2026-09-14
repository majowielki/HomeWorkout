import { Modal, Pressable } from 'react-native';

import { Text } from '@/components/ui/text';
import { screenExercise } from '@/domain/exercises/screen';
import type { Exercise, MedicalProfile } from '@/domain/types';
import { pl } from '@/strings/pl';

type Props = {
  visible: boolean;
  current: Exercise;
  exerciseMap: Record<string, Exercise>;
  profile: MedicalProfile;
  onSelect: (exercise: Exercise) => void;
  onClose: () => void;
};

/** Lets the user swap the current step for one of its allowed substitutes. */
export function SubstituteModal({
  visible,
  current,
  exerciseMap,
  profile,
  onSelect,
  onClose,
}: Props) {
  const options = current.substituteIds
    .map((id) => exerciseMap[id])
    .filter((e): e is Exercise => e !== undefined)
    .filter((e) => screenExercise(e, profile).length === 0);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <Pressable
          className="mt-auto rounded-t-2xl bg-background p-4"
          onPress={(e) => e.stopPropagation()}
        >
          <Text variant="heading" className="mb-3">
            {pl.workout.session.substituteTitle}
          </Text>
          {options.length === 0 ? (
            <Text variant="muted" className="py-4">
              {pl.workout.session.noSubstitutes}
            </Text>
          ) : (
            options.map((exercise) => (
              <Pressable
                key={exercise.id}
                onPress={() => onSelect(exercise)}
                className="border-b border-border py-3.5 active:opacity-60"
              >
                <Text className="text-base">{exercise.name}</Text>
              </Pressable>
            ))
          )}
          <Pressable onPress={onClose} className="items-center py-3.5">
            <Text className="text-primary">{pl.common.cancel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
