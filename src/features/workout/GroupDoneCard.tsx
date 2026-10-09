import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconBadge } from '@/components/ui/icon-badge';
import { Check, Undo2 } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { pl } from '@/strings/pl';

export type Feel = 'too_hard' | 'too_easy';

export interface GroupDoneExercise {
  name: string;
  /** The exposure of the plan, to say how it felt; absent where the card is shown without that question. */
  exposureId?: string;
  /** What the person already said about it. */
  feel?: Feel;
  /** One line per working set, as the history shows it. */
  sets: string[];
}

type Props = {
  exercises: GroupDoneExercise[];
  /** "B1 · Wiosłowanie gumą": what the button leads to. */
  nextLabel: string;
  onNext: () => void;
  /** Takes the set just logged back (a mis-tap on "Seria zrobiona"). */
  onUndo?: () => void;
  /** "Za ciężko" / "Za łatwo" about an exercise just done: context for the next prescription (11 §7). */
  onFeel?: (exposureId: string, feel: Feel) => void;
};

/**
 * Shown when the last set of an exercise — or of the whole superset — is
 * logged: what was just done, then one button on to the next exercise.
 * It stands in for the rest timer, so moving on is always a choice.
 */
export function GroupDoneCard({ exercises, nextLabel, onNext, onUndo, onFeel }: Props) {
  const s = pl.workout.session;
  return (
    <View className="flex-1 justify-center gap-4 p-5">
      <Card className="gap-4 p-6">
        <View className="flex-row items-center gap-3">
          <IconBadge icon={Check} tone="accent" />
          <Text variant="title">{exercises.length > 1 ? s.supersetDone : s.groupDone}</Text>
        </View>
        {exercises.map((e) => (
          <View key={e.name} className="gap-1">
            <Text className="font-display-semibold text-base">{e.name}</Text>
            {e.sets.map((line, i) => (
              <Text key={i} variant="muted" className="text-sm">
                {`${i + 1}. ${line}`}
              </Text>
            ))}
            {onFeel && e.exposureId ? (
              <View className="mt-2 flex-row items-center gap-2">
                {(['too_hard', 'too_easy'] as const).map((feel) => (
                  <Button
                    key={feel}
                    size="sm"
                    variant={e.feel === feel ? 'default' : 'outline'}
                    label={feel === 'too_hard' ? s.feel.tooHard : s.feel.tooEasy}
                    accessibilityState={{ selected: e.feel === feel }}
                    onPress={() => onFeel(e.exposureId!, feel)}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ))}
      </Card>
      <View className="gap-1">
        <Text variant="eyebrow" className="text-center">
          {s.upNext}
        </Text>
        <Text className="text-center font-display-semibold text-base">{nextLabel}</Text>
      </View>
      <Button size="lg" label={s.nextExercise} onPress={onNext} />
      {onUndo ? (
        <Button
          variant="ghost"
          label={s.undoSet}
          icon={<Undo2 size={16} className="text-muted-foreground" />}
          labelClassName="text-muted-foreground"
          onPress={onUndo}
        />
      ) : null}
    </View>
  );
}
