import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { GlossaryButton } from '@/features/glossary/GlossaryButton';
import { QuickCardioForm } from '@/features/workout/QuickCardioForm';
import { useSessionOverview } from '@/features/workout/useSessionOverview';
import { pl } from '@/strings/pl';

export default function WorkoutScreen() {
  const { data, starting, start, resume, discard } = useSessionOverview();
  const [showQuickCardio, setShowQuickCardio] = useState(false);

  function handleDiscard() {
    const inProgress = data?.inProgress;
    if (!inProgress) return;
    Alert.alert(pl.workout.discardConfirmTitle, pl.workout.discardConfirmBody, [
      { text: pl.common.cancel, style: 'cancel' },
      {
        text: pl.workout.discard,
        style: 'destructive',
        onPress: () => void discard(inProgress.id),
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

  const { templates, inProgress, suggested, lastSessionDaysAgo, todayTrainingDate } = data;

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
              onPress={() => resume(inProgress.id)}
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
          <View className="flex-row items-center justify-between">
            <Text variant="muted">
              {lastSessionDaysAgo === null
                ? pl.workout.noSessionsYet
                : pl.workout.lastSession(lastSessionDaysAgo)}
            </Text>
            <GlossaryButton />
          </View>

          {templates.map((template) => (
            <Card
              key={template.id}
              className={template.id === suggested?.id ? 'border-primary/50' : ''}
            >
              <CardTitle>{template.name}</CardTitle>
              <CardDescription>
                {pl.workout.blockCount(template.blocks.length)}
                {template.id === suggested?.id ? ` · ${pl.workout.suggested}` : ''}
              </CardDescription>
              <CardContent>
                <Button
                  label={pl.workout.start}
                  onPress={() => start(template.id)}
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
