import { Link, Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { ChevronRight } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { getSetsForWorkout, type SetLogRow } from '@/db/repositories/setLogs';
import { getTemplate } from '@/db/repositories/templates';
import { deleteWorkout, getWorkout, type WorkoutRow } from '@/db/repositories/workouts';
import {
  countWorkingSets,
  durationMinutes,
  type ExerciseGroup,
  groupSetsByExercise,
} from '@/domain/history/summary';
import { describeSet } from '@/features/history/describeSet';
import { useExerciseMap } from '@/features/workout/useExerciseMap';
import { cn } from '@/lib/cn';
import { formatDate, formatTime } from '@/lib/format';
import { syncReminders } from '@/lib/reminders';
import { pl } from '@/strings/pl';

type Loaded = {
  workout: WorkoutRow;
  templateName: string;
  sets: SetLogRow[];
  groups: ExerciseGroup<SetLogRow>[];
};

type State = { kind: 'loading' } | { kind: 'notFound' } | { kind: 'ready'; data: Loaded };

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const exerciseMap = useExerciseMap();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const workout = await getWorkout(id);
    if (!workout) {
      setState({ kind: 'notFound' });
      return;
    }
    const [template, sets] = await Promise.all([
      workout.templateId ? getTemplate(workout.templateId) : null,
      getSetsForWorkout(id),
    ]);
    setState({
      kind: 'ready',
      data: {
        workout,
        templateName: template?.name ?? pl.history.noTemplate,
        sets,
        groups: groupSetsByExercise(sets),
      },
    });
  }, [id]);

  // Re-read on focus so an edit or delete on the set screen shows up on return.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function confirmDelete() {
    Alert.alert(pl.history.detail.deleteWorkoutTitle, pl.history.detail.deleteWorkoutBody, [
      { text: pl.common.cancel, style: 'cancel' },
      {
        text: pl.history.detail.delete,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (deleting) return;
            setDeleting(true);
            await deleteWorkout(id);
            // The "last session N days ago" reminder may have just moved.
            await syncReminders();
            router.back();
          })();
        },
      },
    ]);
  }

  if (state.kind === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: '' }} />
        <ActivityIndicator />
      </View>
    );
  }

  if (state.kind === 'notFound') {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: '' }} />
        <Text variant="muted">{pl.history.detail.notFound}</Text>
      </View>
    );
  }

  const { workout, templateName, sets, groups } = state.data;
  const minutes = durationMinutes(workout.startedAt, workout.finishedAt);
  const meta = [
    formatTime(workout.startedAt),
    minutes !== null ? pl.history.minutes(minutes) : null,
    pl.history.sets(countWorkingSets(sets)),
    workout.sessionRpe !== null ? pl.history.rpe(workout.sessionRpe) : null,
    workout.status !== 'completed' ? pl.history.status[workout.status] : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-4 pb-10">
      <Stack.Screen options={{ title: formatDate(workout.trainingDate) }} />

      <Card>
        <CardTitle>{templateName}</CardTitle>
        <CardDescription>{meta}</CardDescription>
        {workout.notes ? (
          <CardContent className="mt-2">
            <Text variant="muted" className="text-xs uppercase tracking-wide">
              {pl.history.detail.notes}
            </Text>
            <Text>{workout.notes}</Text>
          </CardContent>
        ) : null}
      </Card>

      {groups.length === 0 ? (
        <Text variant="muted" className="py-4 text-center">
          {pl.history.detail.noSets}
        </Text>
      ) : (
        <>
          <Text variant="muted" className="px-1">
            {pl.history.detail.editHint}
          </Text>
          {groups.map((group) => (
            <Card key={group.exerciseOrder} className="p-0">
              <View className="px-4 pb-1 pt-3">
                <Text variant="heading">
                  {exerciseMap[group.exerciseId]?.name ?? group.exerciseId}
                </Text>
              </View>
              {group.sets.map((set, i) => (
                <Link
                  key={set.id}
                  href={{ pathname: '/history/set/[id]', params: { id: set.id } }}
                  asChild
                >
                  <View
                    accessibilityRole="button"
                    className={cn(
                      'flex-row items-center gap-3 px-4 py-3 active:bg-secondary',
                      i < group.sets.length - 1 && 'border-b border-border',
                    )}
                  >
                    <Text variant="muted" className="w-8 tabular-nums">
                      #{set.setIndex}
                    </Text>
                    <Text className={cn('flex-1', set.isWarmup && 'text-muted-foreground')}>
                      {describeSet(set)}
                      {set.isWarmup ? ` · ${pl.history.detail.warmup}` : ''}
                    </Text>
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </View>
                </Link>
              ))}
            </Card>
          ))}
        </>
      )}

      <Button
        label={pl.history.detail.deleteWorkout}
        variant="outline"
        onPress={confirmDelete}
        disabled={deleting}
        labelClassName="text-destructive"
        className="mt-4"
      />
    </ScrollView>
  );
}
