import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, View } from 'react-native';

import { IconBadge } from '@/components/ui/icon-badge';
import { Bike, ChevronRight, Dumbbell, History, Trash2 } from '@/components/ui/icons';
import { PageHeader, StatusBarScrim } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import {
  type CardioLogRow,
  deleteCardioLog,
  listStandaloneRides,
} from '@/db/repositories/cardioLogs';
import { listAllTemplates } from '@/db/repositories/templates';
import { listWorkouts, type WorkoutListItem } from '@/db/repositories/workouts';
import { durationMinutes } from '@/domain/history/summary';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { pl } from '@/strings/pl';

/**
 * One list, two kinds of entry: strength sessions and bike rides logged
 * on their own. The bike is the safest leg volume this knee gets
 * (PLAN §4.3), so a ride is a first-class entry, not a footnote.
 */
type Row =
  | { kind: 'workout'; id: string; at: string; workout: WorkoutListItem; templateName: string }
  | { kind: 'ride'; id: string; at: string; ride: CardioLogRow };

export default function HistoryScreen() {
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    const [workouts, templates, rides] = await Promise.all([
      listWorkouts(),
      listAllTemplates(),
      listStandaloneRides(),
    ]);
    const names = new Map(templates.map((t) => [t.id, t.name]));
    const merged: Row[] = [
      ...workouts.map((w): Row => ({
        kind: 'workout',
        id: w.id,
        at: w.startedAt,
        workout: w,
        templateName: (w.templateId && names.get(w.templateId)) || pl.history.noTemplate,
      })),
      ...rides.map((r): Row => ({ kind: 'ride', id: r.id, at: r.loggedAt, ride: r })),
    ];
    setRows(merged.sort((a, b) => b.at.localeCompare(a.at)));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function confirmDeleteRide(ride: CardioLogRow) {
    Alert.alert(pl.history.deleteRideTitle, pl.history.deleteRideBody, [
      { text: pl.common.cancel, style: 'cancel' },
      {
        text: pl.history.detail.delete,
        style: 'destructive',
        onPress: () => {
          void deleteCardioLog(ride.id).then(load);
        },
      },
    ]);
  }

  if (!rows) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <FlatList
        className="flex-1"
        contentContainerClassName="gap-2.5 px-5 pb-12"
        data={rows}
        keyExtractor={(row) => `${row.kind}-${row.id}`}
        ListHeaderComponent={
          <PageHeader
            title={pl.history.title}
            eyebrow={rows.length > 0 ? pl.history.entries(rows.length) : undefined}
            className="pb-3"
          />
        }
        ListEmptyComponent={
          <View className="items-center gap-4 rounded-3xl border border-dashed border-border px-8 py-14">
            <IconBadge icon={History} size="lg" />
            <Text variant="title" className="text-center">
              {pl.history.emptyTitle}
            </Text>
            <Text variant="muted" className="text-center">
              {pl.history.empty}
            </Text>
          </View>
        }
        renderItem={({ item }) =>
          item.kind === 'workout' ? (
            <WorkoutRow item={item.workout} templateName={item.templateName} />
          ) : (
            <RideRow ride={item.ride} onDelete={() => confirmDeleteRide(item.ride)} />
          )
        }
      />
      <StatusBarScrim />
    </View>
  );
}

function WorkoutRow({ item, templateName }: { item: WorkoutListItem; templateName: string }) {
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
          'flex-row items-center gap-4 rounded-3xl border border-border bg-card p-4 active:opacity-70',
          dimmed && 'opacity-60',
        )}
        accessibilityRole="button"
      >
        <IconBadge icon={Dumbbell} tone={dimmed ? 'default' : 'accent'} />
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text variant="eyebrow">{formatDate(item.trainingDate)}</Text>
            {item.status !== 'completed' ? (
              <Text className="font-display-medium text-xs text-warning">
                {pl.history.status[item.status]}
              </Text>
            ) : null}
          </View>
          <Text variant="heading">{templateName}</Text>
          <Text variant="muted">{meta}</Text>
        </View>
        <ChevronRight size={18} className="text-muted-foreground" />
      </View>
    </Link>
  );
}

/** A standalone ride has nothing to open; the trash icon deletes it after a confirmation. */
function RideRow({ ride, onDelete }: { ride: CardioLogRow; onDelete: () => void }) {
  return (
    <View className="flex-row items-center gap-4 rounded-3xl border border-border bg-card p-4">
      <IconBadge icon={Bike} />
      <View className="flex-1 gap-0.5">
        <Text variant="eyebrow">{formatDate(ride.trainingDate)}</Text>
        <Text variant="heading">{pl.history.ride}</Text>
        <Text variant="muted">
          {pl.history.rideMeta(ride.minutes, ride.resistanceLevel, ride.rpe)}
        </Text>
      </View>
      <Pressable
        onPress={onDelete}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={pl.history.detail.delete}
      >
        <Trash2 size={18} className="text-muted-foreground" />
      </Pressable>
    </View>
  );
}
