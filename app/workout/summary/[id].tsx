import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { countWorkingSets } from '@/db/repositories/setLogs';
import { getTemplate } from '@/db/repositories/templates';
import { completeWorkout, findPreviousCompleted, getWorkout } from '@/db/repositories/workouts';
import { daysBetween } from '@/domain/time/trainingDate';
import { syncReminders } from '@/lib/reminders';
import { pl } from '@/strings/pl';

const RPE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

type Loaded = {
  templateName: string;
  currentSets: number;
  comparison: { daysAgo: number; previousSets: number } | null;
};

type State = { kind: 'loading' } | { kind: 'notFound' } | { kind: 'ready'; data: Loaded };

export default function SessionSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const workout = await getWorkout(id);
      const template = workout?.templateId ? await getTemplate(workout.templateId) : null;
      if (!workout || !template) {
        if (!cancelled) setState({ kind: 'notFound' });
        return;
      }

      const currentSets = await countWorkingSets(id);
      const previous = await findPreviousCompleted(template.id, id);
      const comparison = previous
        ? {
            daysAgo: daysBetween(previous.trainingDate, workout.trainingDate),
            previousSets: await countWorkingSets(previous.id),
          }
        : null;

      if (!cancelled) {
        setState({ kind: 'ready', data: { templateName: template.name, currentSets, comparison } });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleFinish() {
    if (saving) return;
    setSaving(true);
    await completeWorkout(id, rpe, notes.trim().length > 0 ? notes.trim() : null);
    await syncReminders();
    setSaving(false);
    router.replace('/(tabs)/workout');
  }

  if (state.kind === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (state.kind === 'notFound') {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: '' }} />
        <Text variant="muted">{pl.workout.session.notFound}</Text>
      </View>
    );
  }

  const { templateName, currentSets, comparison } = state.data;

  return (
    <View className="flex-1 gap-4 bg-background p-4">
      <Stack.Screen options={{ title: pl.workout.summary.title }} />

      <Card>
        <CardTitle>{templateName}</CardTitle>
        <CardDescription>{pl.workout.summary.setsLogged(currentSets)}</CardDescription>
        <CardContent>
          <Text variant="muted">
            {comparison
              ? pl.workout.summary.previousComparison(
                  comparison.daysAgo,
                  comparison.previousSets,
                  currentSets,
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
        <Input
          value={notes}
          onChangeText={setNotes}
          placeholder={pl.workout.summary.notesPlaceholder}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          className="h-auto min-h-[80px] py-3"
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
