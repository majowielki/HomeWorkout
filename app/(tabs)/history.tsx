import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { ChevronRight } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { listAllTemplates } from '@/db/repositories/templates';
import { listWorkouts, type WorkoutListItem } from '@/db/repositories/workouts';
import { durationMinutes } from '@/domain/history/summary';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { pl } from '@/strings/pl';

type Row = WorkoutListItem & { templateName: string };

export default function HistoryScreen() {
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    const [workouts, templates] = await Promise.all([listWorkouts(), listAllTemplates()]);
    const names = new Map(templates.map((t) => [t.id, t.name]));
    setRows(
      workouts.map((w) => ({
        ...w,
        templateName: (w.templateId && names.get(w.templateId)) || pl.history.noTemplate,
      })),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!rows) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="gap-2 p-4 pb-8"
      data={rows}
      keyExtractor={(row) => row.id}
      ListEmptyComponent={
        <Text variant="muted" className="py-8 text-center">
          {pl.history.empty}
        </Text>
      }
      renderItem={({ item }) => <WorkoutRow item={item} />}
    />
  );
}

function WorkoutRow({ item }: { item: Row }) {
  const minutes = durationMinutes(item.startedAt, item.finishedAt);
  const dimmed = item.status !== 'completed';
  const meta = [
    pl.history.sets(item.workingSets),
    minutes !== null ? pl.history.minutes(minutes) : null,
    item.sessionRpe !== null ? pl.history.rpe(item.sessionRpe) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link href={{ pathname: '/history/[id]', params: { id: item.id } }} asChild>
      <View
        className={cn(
          'flex-row items-center gap-3 rounded-2xl border border-border bg-card p-4 active:opacity-70',
          dimmed && 'opacity-60',
        )}
        accessibilityRole="button"
      >
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-baseline gap-2">
            <Text className="font-semibold">{formatDate(item.trainingDate)}</Text>
            {item.status !== 'completed' ? (
              <Text variant="muted" className="text-xs uppercase">
                {pl.history.status[item.status]}
              </Text>
            ) : null}
          </View>
          <Text>{item.templateName}</Text>
          <Text variant="muted">{meta}</Text>
        </View>
        <ChevronRight size={18} className="text-muted-foreground" />
      </View>
    </Link>
  );
}
