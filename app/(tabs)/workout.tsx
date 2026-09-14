import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { getDayBoundaryHour } from '@/db/repositories/profile';
import { listActiveTemplates } from '@/db/repositories/templates';
import {
  abandonWorkout,
  findInProgressWorkout,
  lastCompletedWorkout,
  startWorkout,
} from '@/db/repositories/workouts';
import { nextTemplateId } from '@/domain/session/schedule';
import { daysBetween, trainingDate } from '@/domain/time/trainingDate';
import { QuickCardioForm } from '@/features/workout/QuickCardioForm';
import { pl } from '@/strings/pl';

type TemplateRow = Awaited<ReturnType<typeof listActiveTemplates>>[number];
type InProgress = Awaited<ReturnType<typeof findInProgressWorkout>>;

type Loaded = {
  templates: TemplateRow[];
  inProgress: InProgress;
  suggestedId: string | null;
  lastSessionDaysAgo: number | null;
  todayTrainingDate: string;
};

export default function WorkoutScreen() {
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [starting, setStarting] = useState(false);
  const [showQuickCardio, setShowQuickCardio] = useState(false);

  // Runs on every focus so the resume banner and "last session" line are
  // current after coming back from a session. Only the very first load
  // shows a spinner; later refreshes swap the data in place.
  const load = useCallback(async () => {
    const [templates, inProgress, lastWorkout, boundaryHour] = await Promise.all([
      listActiveTemplates(),
      findInProgressWorkout(),
      lastCompletedWorkout(),
      getDayBoundaryHour(),
    ]);
    const today = trainingDate(new Date(), boundaryHour);
    setData({
      templates,
      inProgress,
      suggestedId: nextTemplateId(templates, lastWorkout?.templateId ?? null),
      lastSessionDaysAgo: lastWorkout ? daysBetween(lastWorkout.trainingDate, today) : null,
      todayTrainingDate: today,
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function handleStart(templateId: string) {
    if (starting) return;
    setStarting(true);
    try {
      const boundaryHour = await getDayBoundaryHour();
      const workoutId = await startWorkout(templateId, trainingDate(new Date(), boundaryHour));
      router.push({ pathname: '/workout/active/[id]', params: { id: workoutId } });
    } finally {
      setStarting(false);
    }
  }

  function handleDiscard() {
    const inProgress = data?.inProgress;
    if (!inProgress) return;
    Alert.alert(pl.workout.discardConfirmTitle, pl.workout.discardConfirmBody, [
      { text: pl.common.cancel, style: 'cancel' },
      {
        text: pl.workout.discard,
        style: 'destructive',
        onPress: () => {
          void abandonWorkout(inProgress.id).then(load);
        },
      },
    ]);
  }

  if (!data) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  const { templates, inProgress, suggestedId, lastSessionDaysAgo, todayTrainingDate } = data;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-4">
      {inProgress ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardTitle>
            {pl.workout.resumeBanner(
              templates.find((t) => t.id === inProgress.templateId)?.name ?? '',
            )}
          </CardTitle>
          <CardContent className="flex-row gap-2">
            <Button
              label={pl.workout.resume}
              className="flex-1"
              onPress={() =>
                router.push({ pathname: '/workout/active/[id]', params: { id: inProgress.id } })
              }
            />
            <Button
              label={pl.workout.discard}
              variant="outline"
              className="flex-1"
              onPress={handleDiscard}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Text variant="muted">
            {lastSessionDaysAgo === null
              ? pl.workout.noSessionsYet
              : pl.workout.lastSession(lastSessionDaysAgo)}
          </Text>

          {templates.map((template) => (
            <Card
              key={template.id}
              className={template.id === suggestedId ? 'border-primary/50' : ''}
            >
              <CardTitle>{template.name}</CardTitle>
              <CardDescription>
                {pl.workout.blockCount(template.blocks.length)}
                {template.id === suggestedId ? ` · ${pl.workout.suggested}` : ''}
              </CardDescription>
              <CardContent>
                <Button
                  label={pl.workout.start}
                  onPress={() => handleStart(template.id)}
                  disabled={starting}
                />
              </CardContent>
            </Card>
          ))}
        </>
      )}

      {showQuickCardio ? (
        <QuickCardioForm
          trainingDate={todayTrainingDate}
          onLogged={() => setShowQuickCardio(false)}
          onCancel={() => setShowQuickCardio(false)}
        />
      ) : (
        <Button
          label={pl.workout.quickCardio}
          variant="outline"
          onPress={() => setShowQuickCardio(true)}
        />
      )}
    </ScrollView>
  );
}
