import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import {
  abandonWorkout,
  findInProgressWorkout,
  lastCompletedWorkout,
  startWorkout,
} from '@/db/repositories/workouts';
import { getDayBoundaryHour } from '@/db/repositories/profile';
import { listActiveTemplates } from '@/db/repositories/templates';
import { nextTemplateId } from '@/domain/session/schedule';
import { daysBetween, trainingDate } from '@/domain/time/trainingDate';
import { QuickCardioForm } from '@/features/workout/QuickCardioForm';
import { pl } from '@/strings/pl';

type TemplateRow = Awaited<ReturnType<typeof listActiveTemplates>>[number];
type InProgress = Awaited<ReturnType<typeof findInProgressWorkout>>;

export default function WorkoutScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [inProgress, setInProgress] = useState<InProgress>(null);
  const [suggestedId, setSuggestedId] = useState<string | null>(null);
  const [lastSessionDaysAgo, setLastSessionDaysAgo] = useState<number | null>(null);
  const [todayTrainingDate, setTodayTrainingDate] = useState<string | null>(null);
  const [showQuickCardio, setShowQuickCardio] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [rows, active, lastWorkout, boundaryHour] = await Promise.all([
      listActiveTemplates(),
      findInProgressWorkout(),
      lastCompletedWorkout(),
      getDayBoundaryHour(),
    ]);
    const today = trainingDate(new Date(), boundaryHour);
    setTemplates(rows);
    setInProgress(active);
    setSuggestedId(nextTemplateId(rows, lastWorkout?.templateId ?? null));
    setTodayTrainingDate(today);
    setLastSessionDaysAgo(lastWorkout ? daysBetween(lastWorkout.trainingDate, today) : null);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function handleStart(templateId: string) {
    const boundaryHour = await getDayBoundaryHour();
    const date = trainingDate(new Date(), boundaryHour);
    const workoutId = await startWorkout(templateId, date);
    router.push({ pathname: '/workout/active/[id]', params: { id: workoutId } });
  }

  async function handleDiscard() {
    if (!inProgress) return;
    await abandonWorkout(inProgress.id);
    void load();
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

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
                {template.blocks.length} bloków
                {template.id === suggestedId ? ` · ${pl.workout.suggested}` : ''}
              </CardDescription>
              <CardContent>
                <Button label={pl.workout.start} onPress={() => handleStart(template.id)} />
              </CardContent>
            </Card>
          ))}
        </>
      )}

      {showQuickCardio && todayTrainingDate ? (
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
