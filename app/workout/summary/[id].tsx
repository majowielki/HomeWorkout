import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { countWorkingSets } from '@/db/repositories/setLogs';
import { completeWorkout, findPreviousCompleted, getWorkout } from '@/db/repositories/workouts';
import { getTemplate } from '@/db/repositories/templates';
import { daysBetween } from '@/domain/time/trainingDate';
import { pl } from '@/strings/pl';

const RPE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

type State = {
  templateName: string;
  currentSets: number;
  comparison: { daysAgo: number; previousSets: number } | null;
};

export default function SessionSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [state, setState] = useState<State | null>(null);
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const workout = await getWorkout(id);
      if (!workout || !workout.templateId) return;
      const template = await getTemplate(workout.templateId);
      const currentSets = await countWorkingSets(id);

      let comparison: State['comparison'] = null;
      const previous = await findPreviousCompleted(workout.templateId, id);
      if (previous) {
        const previousSets = await countWorkingSets(previous.id);
        comparison = {
          daysAgo: daysBetween(previous.trainingDate, workout.trainingDate),
          previousSets,
        };
      }

      if (!cancelled) {
        setState({ templateName: template?.name ?? '', currentSets, comparison });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleFinish() {
    setSaving(true);
    await completeWorkout(id, rpe, notes.trim().length > 0 ? notes.trim() : null);
    setSaving(false);
    router.replace('/(tabs)/workout');
  }

  if (!state) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 gap-4 bg-background p-4">
      <Stack.Screen options={{ title: pl.workout.summary.title }} />

      <Card>
        <CardTitle>{state.templateName}</CardTitle>
        <CardDescription>{pl.workout.summary.setsLogged(state.currentSets)}</CardDescription>
        <CardContent>
          <Text variant="muted">
            {state.comparison
              ? pl.workout.summary.previousComparison(
                  state.comparison.daysAgo,
                  state.comparison.previousSets,
                  state.currentSets,
                )
              : pl.workout.summary.noPrevious}
          </Text>
        </CardContent>
      </Card>

      <View className="gap-2">
        <Text variant="muted">{pl.workout.summary.sessionRpe}</Text>
        <View className="flex-row flex-wrap gap-2">
          {RPE_OPTIONS.map((value) => (
            <Chip
              key={value}
              label={String(value)}
              selected={rpe === value}
              onPress={() => setRpe(value)}
            />
          ))}
        </View>
      </View>

      <View className="gap-2">
        <Text variant="muted">{pl.workout.summary.notes}</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder={pl.workout.summary.notesPlaceholder}
          placeholderTextColor="hsl(240 4% 46%)"
          multiline
          numberOfLines={3}
          className="min-h-[80px] rounded-xl border border-input bg-background p-3 text-base text-foreground"
        />
      </View>

      <Button
        label={pl.workout.summary.finish}
        size="lg"
        onPress={handleFinish}
        disabled={saving}
        className="mt-auto"
      />
    </View>
  );
}
