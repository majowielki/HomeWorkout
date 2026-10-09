import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { MUSCLE_GROUPS } from '@/domain/coach/vocabulary';
import { volumeTargets, type VolumeTargets } from '@/domain/policy/dayPolicy';
import type { MuscleGroup } from '@/domain/types';
import { cn } from '@/lib/cn';
import { pl } from '@/strings/pl';

type Props = {
  volume: Record<MuscleGroup, { certain: number; uncertain: number }>;
  /** The range the person's profile aims for; the standard one when absent. */
  targets?: VolumeTargets;
};

/**
 * Direct working sets per muscle over the last 7 days against the range
 * the planner aims for (SPEC §4.1, §10.4): under the minimum, in range,
 * at the maximum. The figure the planner counts, so the bars explain it.
 */
export function VolumeMeter({ volume, targets = volumeTargets(undefined) }: Props) {
  const { min } = targets.weekly;
  return (
    <View className="gap-2.5">
      {MUSCLE_GROUPS.map((m) => {
        const max = targets.maxOf(m);
        const work = volume[m];
        const sets = work.certain;
        const share = Math.min(1, sets / max);
        const tone =
          sets < min ? 'bg-muted-foreground/40' : sets >= max ? 'bg-highlight' : 'bg-primary';
        return (
          <View key={m} className="gap-1">
            <View className="flex-row justify-between">
              <Text className="text-sm">{pl.labels.muscle[m]}</Text>
              <Text variant="muted" className="text-xs tabular-nums">
                {pl.plan.volumeValue(sets, max)}
                {work.uncertain > 0 ? ` + ${work.uncertain} ${pl.plan.uncertainSets}` : ''}
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
