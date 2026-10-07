import { View } from 'react-native';

import { Card } from '@/components/ui/card';
import { IconBadge } from '@/components/ui/icon-badge';
import { Check } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { MuscleRecovery } from '@/domain/plan/dayState';
import { formatDate } from '@/lib/format';
import { pl } from '@/strings/pl';

type Props = {
  recovery: readonly MuscleRecovery[];
};

/**
 * "Dziś zrobione": today's training is behind, so the screen says what
 * rests and until when, instead of offering another session. One line per
 * day the muscles come back.
 */
export function DayDoneCard({ recovery }: Props) {
  const t = pl.plan.done;
  const byDay = new Map<string, string[]>();
  for (const r of recovery) {
    const list = byDay.get(r.readyOn) ?? [];
    list.push(pl.labels.muscle[r.muscle]);
    byDay.set(r.readyOn, list);
  }

  return (
    <Card className="gap-4 p-6">
      <View className="flex-row items-center gap-3">
        <IconBadge icon={Check} tone="accent" />
        <View className="flex-1">
          <Text variant="eyebrow">{t.eyebrow}</Text>
          <Text variant="title">{t.title}</Text>
        </View>
      </View>
      {byDay.size > 0 ? (
        <View className="gap-2">
          {[...byDay].map(([day, muscles]) => (
            <View key={day} className="gap-0.5 rounded-2xl bg-secondary px-4 py-3">
              <Text variant="muted" className="text-xs">
                {t.readyFrom(formatDate(day))}
              </Text>
              <Text className="font-display-semibold text-base text-secondary-foreground">
                {muscles.join(', ')}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text variant="muted">{t.nothingRests}</Text>
      )}
    </Card>
  );
}
