import { Stack } from 'expo-router';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { TRAINING_CONFIG } from '@/domain/config/training';
import { planTitle, prescriptionText } from '@/features/plan/format';
import { SLOT_BY_ID } from '@/features/plan/slots';
import { usePlanToday } from '@/features/plan/usePlanToday';
import { VolumeMeter } from '@/features/plan/VolumeMeter';
import { useExerciseMap } from '@/features/workout/useExerciseMap';
import { pl } from '@/strings/pl';

/**
 * "Why this plan?" — every decision of the day as the engine made it:
 * the day, the bike, each exercise with its reasons, the movements left
 * out today and why, and the week's direct sets. Codes become sentences
 * here (SPEC §1.2); the engine never writes prose.
 */
export default function PlanScreen() {
  const today = usePlanToday();
  const exerciseMap = useExerciseMap();
  const { state } = today;

  if (state.status !== 'ready') {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background p-5">
        <Stack.Screen options={{ title: pl.plan.screenTitle }} />
        {state.status === 'loading' ? (
          <ActivityIndicator />
        ) : (
          <>
            <Text>{pl.plan.loadError}</Text>
            <Button label={pl.plan.retry} onPress={() => void today.reload()} />
          </>
        )}
      </View>
    );
  }

  const { plan, events, volume } = state;
  const nameOf = (id: string | null) => (id ? (exerciseMap[id]?.name ?? id) : '—');
  const dayLines = [
    ...events.map((e) => pl.plan.blockEvent[e]),
    ...plan.dayReasons.map((r) => pl.plan.day[r]),
    ...plan.signals.map((s) => pl.plan.signal[s]),
    ...(plan.phase === 'deload' ? [pl.plan.deloadNote] : []),
  ];

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 px-5 pb-12 pt-4">
      <Stack.Screen options={{ title: pl.plan.screenTitle }} />

      <View className="gap-1">
        <Text variant="title">{planTitle(plan)}</Text>
        <Text variant="muted">{pl.plan.meta(plan.estimatedMinutes, plan.bike.minutes)}</Text>
      </View>

      {dayLines.length > 0 ? (
        <Card className="gap-2">
          <CardTitle>{pl.plan.sections.day}</CardTitle>
          {dayLines.map((line) => (
            <Text key={line} className="leading-6">
              {line}
            </Text>
          ))}
        </Card>
      ) : null}

      <Card className="gap-2">
        <CardTitle>{pl.plan.sections.bike}</CardTitle>
        <Text>{pl.plan.bikeLine(plan.bike.minutes, plan.bike.resistance)}</Text>
        {plan.bike.reasons.map((r) => (
          <Text key={r} variant="muted">
            {pl.plan.bike[r]}
          </Text>
        ))}
      </Card>

      <Card className="gap-4">
        <CardTitle>{pl.plan.sections.exercises}</CardTitle>
        {plan.exercises.map((e) => (
          <View key={`${e.label}-${e.exerciseId}`} className="gap-1">
            <Text className="font-display-semibold">
              {e.label} · {nameOf(e.exerciseId)}
            </Text>
            <Text variant="muted" className="text-sm">
              {prescriptionText(e)}
            </Text>
            {e.reasons.map((r) => (
              <Text key={r} className="text-sm leading-5">
                {pl.plan.progression[r]}
              </Text>
            ))}
          </View>
        ))}
      </Card>

      {plan.skipped.length > 0 ? (
        <Card className="gap-2">
          <CardTitle>{pl.plan.sections.skipped}</CardTitle>
          {plan.skipped.map((s) => (
            <Text key={s.slotId} className="text-sm leading-5">
              <Text className="font-display-semibold text-sm">
                {SLOT_BY_ID.get(s.slotId)?.name ?? s.slotId}
              </Text>
              {s.exerciseId ? ` (${nameOf(s.exerciseId)})` : ''}: {pl.plan.skip[s.reason]}
            </Text>
          ))}
        </Card>
      ) : null}

      {plan.adjustments.length > 0 ? (
        <Card className="gap-2">
          <CardTitle>{pl.plan.sections.changes}</CardTitle>
          {plan.adjustments.map((a, i) => (
            <Text key={`${a.exerciseId}-${a.code}-${i}`} className="text-sm">
              {nameOf(a.exerciseId)}: {pl.plan.validation[a.code]}
            </Text>
          ))}
        </Card>
      ) : null}

      <Card className="gap-3">
        <CardTitle>{pl.plan.sections.volume}</CardTitle>
        <Text variant="muted" className="text-sm">
          {pl.plan.sections.volumeHint(TRAINING_CONFIG.weeklyWorkingSetsPerMuscle.min)}
        </Text>
        <VolumeMeter volume={volume} />
      </Card>
    </ScrollView>
  );
}
