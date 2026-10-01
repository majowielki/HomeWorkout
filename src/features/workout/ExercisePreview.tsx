import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { Exercise, TemplateBlock } from '@/domain/types';
import { cn } from '@/lib/cn';
import { pl } from '@/strings/pl';

type Props = {
  blocks: readonly TemplateBlock[];
  exerciseMap: Record<string, Exercise>;
  /** How many exercise pills to show before collapsing the rest into "+N". */
  max?: number;
  /** Pills for the dark hero surface instead of a regular card. */
  onInverse?: boolean;
};

/** A template's exercises as a wrap of small pills: "A1 Przysiad goblet", ... "+3". */
export function ExercisePreview({ blocks, exerciseMap, max = 4, onInverse }: Props) {
  const shown = blocks.slice(0, max);
  const rest = blocks.length - shown.length;
  const pill = cn(
    'flex-row items-center gap-1.5 rounded-full px-3 py-1.5',
    onInverse ? 'bg-inverse-foreground/10' : 'bg-secondary',
  );
  const label = cn('text-xs', onInverse ? 'text-inverse-foreground' : 'text-secondary-foreground');
  const tag = cn(
    'font-display-semibold text-xs',
    onInverse ? 'text-primary' : 'text-muted-foreground',
  );

  return (
    <View className="flex-row flex-wrap gap-1.5">
      {shown.map((block, i) => (
        <View key={`${block.label}-${i}`} className={pill}>
          <Text className={tag}>{block.label}</Text>
          <Text className={label} numberOfLines={1}>
            {exerciseMap[block.exerciseId]?.name ?? block.exerciseId}
          </Text>
        </View>
      ))}
      {rest > 0 ? (
        <View className={pill}>
          <Text className={tag}>{pl.workout.moreExercises(rest)}</Text>
        </View>
      ) : null}
    </View>
  );
}
