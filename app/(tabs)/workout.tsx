import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Bike, Play } from '@/components/ui/icons';
import { ListRow } from '@/components/ui/list-row';
import { PageHeader, StatusBarScrim } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { GlossaryButton } from '@/features/glossary/GlossaryButton';
import { ExercisePreview } from '@/features/workout/ExercisePreview';
import { QuickCardioForm } from '@/features/workout/QuickCardioForm';
import { SessionHero } from '@/features/workout/SessionHero';
import { useExerciseMap } from '@/features/workout/useExerciseMap';
import { useSessionOverview } from '@/features/workout/useSessionOverview';
import { pl } from '@/strings/pl';

export default function WorkoutScreen() {
  const { data, starting, start, resume, discard } = useSessionOverview();
  const exerciseMap = useExerciseMap();
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
  const inProgressTemplate = inProgress
    ? templates.find((t) => t.id === inProgress.templateId)
    : undefined;
  // The suggested template is the hero; the rest are listed below it.
  const others = templates.filter((t) => t.id !== suggested?.id);

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        <PageHeader
          title={pl.workout.title}
          subtitle={
            lastSessionDaysAgo === null
              ? pl.workout.noSessionsYet
              : pl.workout.lastSession(lastSessionDaysAgo)
          }
          right={<GlossaryButton />}
        />

        {inProgress ? (
          <SessionHero
            eyebrow={pl.today.inProgressEyebrow}
            title={inProgressTemplate?.name ?? ''}
            badge={pl.history.status.in_progress}
            blocks={inProgressTemplate?.blocks}
            exerciseMap={exerciseMap}
          >
            <Button
              size="lg"
              label={pl.workout.resume}
              icon={<Play size={18} className="text-primary-foreground" />}
              onPress={() => resume(inProgress.id)}
            />
            <Button
              label={pl.workout.discard}
              variant="ghost"
              labelClassName="text-inverse-muted"
              onPress={handleDiscard}
            />
          </SessionHero>
        ) : (
          <>
            {suggested ? (
              <SessionHero
                eyebrow={pl.today.nextSessionEyebrow}
                title={suggested.name}
                badge={pl.workout.suggested}
                meta={pl.workout.blockCount(suggested.blocks.length)}
                blocks={suggested.blocks}
                exerciseMap={exerciseMap}
              >
                <Button
                  size="lg"
                  label={pl.workout.start}
                  icon={<Play size={18} className="text-primary-foreground" />}
                  onPress={() => start(suggested.id)}
                  disabled={starting}
                />
              </SessionHero>
            ) : null}

            {others.length > 0 ? (
              <Text variant="eyebrow" className="mt-2">
                {pl.workout.templatesEyebrow}
              </Text>
            ) : null}
            {others.map((template) => (
              <Card key={template.id} className="gap-4">
                <View className="gap-1">
                  <Text variant="title">{template.name}</Text>
                  <Text variant="muted">{pl.workout.blockCount(template.blocks.length)}</Text>
                </View>
                <ExercisePreview blocks={template.blocks} exerciseMap={exerciseMap} />
                <Button
                  label={pl.workout.start}
                  variant="inverse"
                  onPress={() => start(template.id)}
                  disabled={starting}
                />
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
          <Card className="py-1">
            <ListRow
              icon={Bike}
              title={pl.workout.quickCardio}
              subtitle={pl.workout.quickCardioHint}
              onPress={() => setShowQuickCardio(true)}
            />
          </Card>
        )}
      </ScrollView>
      <StatusBarScrim />
    </View>
  );
}
