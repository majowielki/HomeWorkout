import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { MUSCLE_GROUPS } from '@/domain/coach/vocabulary';
import { TRAINING_CONFIG } from '@/domain/config/training';
import type { MuscleGroup } from '@/domain/types';
import { maxDirectSets } from '@/domain/volume/weekly';
import { cn } from '@/lib/cn';
import { pl } from '@/strings/pl';

type Props = { volume: Record<MuscleGroup, number> };

/**
 * Direct working sets per muscle over the last 7 days against the range
 * the planner aims for (SPEC §4.1, §10.4): under the minimum, in range,
 * at the maximum. The figure the planner counts, so the bars explain it.
 */
export function VolumeMeter({ volume }: Props) {
  const { min } = TRAINING_CONFIG.weeklyWorkingSetsPerMuscle;
  return (
    <View className="gap-2.5">
      {MUSCLE_GROUPS.map((m) => {
        const max = maxDirectSets(m);
        const sets = volume[m];
        const share = Math.min(1, sets / max);
        const tone =
          sets < min ? 'bg-muted-foreground/40' : sets >= max ? 'bg-highlight' : 'bg-primary';
        return (
          <View key={m} className="gap-1">
            <View className="flex-row justify-between">
              <Text className="text-sm">{pl.labels.muscle[m]}</Text>
              <Text variant="muted" className="text-xs tabular-nums">
                {pl.plan.volumeValue(sets, max)}
              </Text>
            </View>
            <View className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <View
                className={cn('h-full rounded-full', tone)}
                style={{ width: `${share * 100}%` }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}
