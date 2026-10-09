import { Link, Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Bike, ChevronRight } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { type CardioLogRow, getCardioForWorkout } from '@/db/repositories/cardioLogs';
import { getSetsForWorkout, type SetLogRow } from '@/db/repositories/setLogs';
import { deleteWorkout, getWorkout, type WorkoutRow } from '@/db/repositories/workouts';
import {
  countWorkingSets,
  durationMinutes,
  type ExerciseGroup,
  groupSetsByExercise,
} from '@/domain/history/summary';
import { describeSet } from '@/features/history/describeSet';
import { workoutTitle } from '@/features/history/workoutTitle';
import { useExerciseMap } from '@/features/workout/useExerciseMap';
import { cn } from '@/lib/cn';
import { formatDate, formatTime } from '@/lib/format';
import { syncReminders } from '@/lib/reminders';
import { pl } from '@/strings/pl';

type Loaded = {
  workout: WorkoutRow;
  title: string;
  sets: SetLogRow[];
  groups: ExerciseGroup<SetLogRow>[];
  cardio: CardioLogRow[];
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
    const [sets, cardio] = await Promise.all([getSetsForWorkout(id), getCardioForWorkout(id)]);
    setState({
      kind: 'ready',
      data: {
        workout,
        title: workoutTitle(workout),
        sets,
        groups: groupSetsByExercise(sets),
        cardio,
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
            try {
              await deleteWorkout(id);
              // The "last session N days ago" reminder may have just moved.
              await syncReminders();
              router.back();
            } finally {
              setDeleting(false);
            }
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

  const { workout, title, sets, groups, cardio } = state.data;
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
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 px-5 pb-12 pt-4">
      <Stack.Screen options={{ title: formatDate(workout.trainingDate) }} />

      <Card>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{meta}</CardDescription>
        {workout.notes ? (
          <CardContent className="mt-2">
            <Text variant="eyebrow">{pl.history.detail.notes}</Text>
            <Text>{workout.notes}</Text>
          </CardContent>
        ) : null}
      </Card>

      {cardio.length > 0 ? (
        <Card>
          <View className="flex-row items-center gap-2">
            <Bike size={16} className="text-muted-foreground" />
            <CardTitle>{pl.history.detail.bike}</CardTitle>
          </View>
          <CardContent className="mt-1">
            {cardio.map((c) => (
              <Text key={c.id} variant="muted">
                {pl.history.detail.bikePurpose[c.purpose]} ·{' '}
                {pl.history.rideMeta(c.minutes, c.resistanceLevel, c.rpe)}
              </Text>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {groups.length === 0 ? (
        <Text variant="muted" className="py-4 text-center">
          {pl.history.detail.noSets}
        </Text>
      ) : (
        <>
          {sets.some((set) => set.observation) ? (
            <Text variant="muted" className="px-1">
              {pl.history.detail.editHint}
            </Text>
          ) : null}
          {groups.map((group) => (
            <Card key={group.exerciseOrder} className="p-0">
              <View className="px-4 pb-1 pt-3">
                <Text variant="heading">
                  {exerciseMap[group.exerciseId]?.name ?? group.exerciseId}
                </Text>
              </View>
              {group.sets.map((set, i) => (
                <SetLine key={set.id} set={set} last={i === group.sets.length - 1} />
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

/** One set of the list. A set of the old engine has no record to correct and is only read. */
function SetLine({ set, last }: { set: SetLogRow; last: boolean }) {
  const line = (
    <View
      accessibilityRole={set.observation ? 'button' : undefined}
      className={cn(
        'flex-row items-center gap-3 px-4 py-3',
        set.observation && 'active:bg-secondary',
        !last && 'border-b border-border',
      )}
    >
      <Text variant="muted" className="w-8 tabular-nums">
        #{set.setIndex}
      </Text>
      <Text className={cn('flex-1', set.isWarmup && 'text-muted-foreground')}>
        {describeSet(set)}
        {set.isWarmup ? ` · ${pl.history.detail.warmup}` : ''}
      </Text>
      {set.observation ? <ChevronRight size={16} className="text-muted-foreground" /> : null}
    </View>
  );
  return set.observation ? (
    <Link href={{ pathname: '/history/set/[id]', params: { id: set.id } }} asChild>
      {line}
    </Link>
  ) : (
    line
  );
}
