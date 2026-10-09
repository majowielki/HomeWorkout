import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { Exercise } from '@/domain/types';
import type { SessionPlan } from '@/domain/plan/plan';
import { labelsOf } from '@/domain/session/progress';
import { cn } from '@/lib/cn';
import { pl } from '@/strings/pl';

type Props = {
  plan: SessionPlan;
  exerciseMap: Record<string, Exercise>;
  /** How many exercise pills to show before collapsing the rest into "+N". */
  max?: number;
  /** Pills for the dark hero surface instead of a regular card. */
  onInverse?: boolean;
};

/** The plan's exercises as a wrap of small pills: "A1 Przysiad goblet", ... "+3". */
export function ExercisePreview({ plan, exerciseMap, max = 4, onInverse }: Props) {
  const shown = plan.exposures.slice(0, max);
  const labels = labelsOf(plan);
  const rest = plan.exposures.length - shown.length;
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
        <View key={block.id} className={pill}>
          <Text className={tag}>{labels[i]}</Text>
          <Text className={label} numberOfLines={1}>
            {exerciseMap[block.exercise.id]?.name ?? block.exercise.displayName}
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
