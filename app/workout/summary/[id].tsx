import { randomUUID } from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Undo2 } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { closeSessionV2, readSessionState, undoSetV2 } from '@/db/repositories/sessionsV2';
import { isDone } from '@/domain/commands/result';
import { latestResult } from '@/domain/session/progress';
import { GlossaryButton } from '@/features/glossary/GlossaryButton';
import { planTitle } from '@/features/plan/format';
import { rememberUndone } from '@/features/workout/undoneSet';
import { syncReminders } from '@/lib/reminders';
import { pl } from '@/strings/pl';

const RPE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export default function SessionSummaryScreen() {
  // `back`: what "Wróć do treningu" does — 'undo' takes the last set back
  // (every set was done, so the last tap may have been a mistake),
  // 'resume' just returns to a workout finished early.
  const { id, back } = useLocalSearchParams<{ id: string; back?: 'undo' | 'resume' }>();
  const router = useRouter();

  // Read once: the summary is a short stop between the session and the day.
  const [session] = useState(() => readSessionState(id));
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleFinish() {
    if (saving) return;
    setSaving(true);
    try {
      const result = closeSessionV2({
        commandId: randomUUID(),
        sessionId: id,
        how: 'completed',
        sessionRpe: rpe,
        notes: notes.trim().length > 0 ? notes.trim() : null,
      });
      if (!isDone(result)) {
        console.warn('could not close the session', result);
        return;
      }
      await syncReminders();
      router.replace('/(tabs)/workout');
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    if (saving) return;
    const last = back === 'resume' || !session ? null : latestResult(session.results.values());
    if (last !== null) {
      const result = undoSetV2({ commandId: randomUUID(), sessionId: id, observationId: last.id });
      if (isDone(result)) {
        rememberUndone(id, {
          plannedSetId: last.observation.plannedSetId!,
          result: last.observation,
        });
      }
    }
    router.replace({ pathname: '/workout/active/[id]', params: { id } });
  }

  if (session === null || session.workout.status !== 'in_progress') {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: '' }} />
        <Text variant="muted">{pl.workout.session.notFound}</Text>
      </View>
    );
  }

  const workingSets = session.plan.exposures
    .flatMap((e) => e.sets)
    .filter((s) => s.role !== 'warmup' && session.results.has(s.id)).length;

  return (
    <View className="flex-1 gap-4 bg-background p-4">
      <Stack.Screen options={{ title: pl.workout.summary.title }} />

      <Card>
        <CardTitle>{planTitle(session.plan)}</CardTitle>
        <CardDescription>{pl.workout.summary.setsLogged(workingSets)}</CardDescription>
        <CardContent>
          <Text variant="muted">{pl.workout.summary.plannedNext}</Text>
        </CardContent>
      </Card>

      <View className="gap-2">
        <View className="flex-row items-center justify-between">
          <Text variant="muted">{pl.workout.summary.sessionRpe}</Text>
          <GlossaryButton />
        </View>
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
      <Button
        label={pl.workout.summary.backToSession}
        variant="ghost"
        icon={<Undo2 size={16} className="text-muted-foreground" />}
        labelClassName="text-muted-foreground"
        onPress={handleBack}
        disabled={saving}
      />
      {back !== 'resume' ? (
        <Text variant="muted" className="-mt-3 text-center text-xs">
          {pl.workout.summary.backUndoHint}
        </Text>
      ) : null}
    </View>
  );
}
