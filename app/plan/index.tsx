import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { RefreshCw } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { traceText } from '@/domain/progression/decisionText';
import { labelsOf } from '@/domain/session/progress';
import { volumeTargets } from '@/domain/policy/dayPolicy';
import { planTitle, prescriptionText } from '@/features/plan/format';
import { SLOT_BY_ID } from '@/features/plan/slots';
import { usePlanToday } from '@/features/plan/usePlanToday';
import { VolumeMeter } from '@/features/plan/VolumeMeter';
import { PlanningFeedback } from '@/features/plan/PlanningFeedback';
import { useExerciseMap } from '@/features/workout/useExerciseMap';
import { addDays } from '@/domain/time/trainingDate';
import { formatDate } from '@/lib/format';
import { pl } from '@/strings/pl';

/**
 * "Why this plan?" — every decision of the day as the engine made it:
 * the day, the bike, each exercise with its reasons, the movements left
 * out today and why, and the week's direct sets. Codes become sentences
 * here (SPEC §1.2); the engine never writes prose.
 */
export default function PlanScreen() {
  const { date } = useLocalSearchParams<{ date?: string }>();
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

  // Once today is done, "why" is about tomorrow's plan; today's block events are old news.
  const upcoming = state.week.find((d) => d.date > state.asOf && d.forecast)?.forecast ?? null;
  const plan = date
    ? date === state.asOf
      ? state.plan
      : (state.week.find((d) => d.date === date)?.forecast ?? null)
    : state.done
      ? (state.tomorrow ?? upcoming)
      : (state.plan ?? upcoming);
  const isToday = plan?.trainingDate === state.asOf;
  if (!plan) {
    return (
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="gap-4 px-5 pb-12 pt-4"
      >
        <Stack.Screen options={{ title: pl.plan.screenTitle }} />
        <Card className="gap-2">
          <CardTitle>{state.done ? pl.plan.done.eyebrow : pl.plan.restDay.title}</CardTitle>
          <Text variant="muted">{state.done ? pl.plan.noneAhead : pl.plan.restDay.body}</Text>
        </Card>
        <RecalculateButton today={today} />
      </ScrollView>
    );
  }
  const events = isToday ? state.events : [];
  const { volume } = state;
  const targets = volumeTargets(state.preview.input.preferences);
  const summary = isToday
    ? state.summary
    : state.week.find((d) => d.date === plan.trainingDate)?.summary;
  const labels = labelsOf(plan);
  const textOf = (dict: Readonly<Record<string, string>>, code: string) => dict[code] ?? '';
  const bike = isToday
    ? state.bike
    : {
        minutes: summary?.bike?.minutes ?? 0,
        resistance: null,
        reasons: summary?.bike?.reasons ?? [],
      };
  const screenTitle = isToday
    ? pl.plan.screenTitle
    : plan.trainingDate === addDays(state.asOf, 1)
      ? pl.plan.tomorrowScreenTitle
      : pl.plan.nextScreenTitle;
  const nameOf = (id: string | null) => (id ? (exerciseMap[id]?.name ?? id) : '—');
  const dayLines = [
    ...events.map((e) => pl.plan.blockEvent[e]),
    ...(summary?.dayReasons ?? []).map((r) => textOf(pl.plan.day, r)),
    ...(summary?.signals ?? []).map((s) => textOf(pl.plan.signal, s)),
    ...(summary?.phase === 'deload' ? [pl.plan.deloadNote] : []),
  ];

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 px-5 pb-12 pt-4">
      <Stack.Screen options={{ title: screenTitle }} />

      <View className="gap-1">
        <Text variant="title">{planTitle(plan)}</Text>
        <Text variant="muted">
          {formatDate(plan.trainingDate)} · {pl.plan.meta(Math.ceil(plan.time.exerciseTotal / 60))}
        </Text>
      </View>
      {isToday ? <PlanningFeedback result={state.preview.output.result} /> : null}

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
        <Text>{pl.plan.bikeLine(bike.minutes, bike.resistance)}</Text>
        {bike.reasons.map((r) => (
          <Text key={r} variant="muted">
            {textOf(pl.plan.bike, r)}
          </Text>
        ))}
      </Card>

      <Card className="gap-4">
        <CardTitle>{pl.plan.sections.exercises}</CardTitle>
        {plan.exposures.map((e, i) => (
          <View key={e.id} className="gap-1">
            <Text className="font-display-semibold">
              {labels[i]} · {nameOf(e.exercise.id)}
            </Text>
            <Text variant="muted" className="text-sm">
              {prescriptionText(e)}
            </Text>
            {traceText(e.trace).map((line) => (
              <Text key={line} className="text-sm leading-5">
                {line}
              </Text>
            ))}
          </View>
        ))}
      </Card>

      {(summary?.skipped.length ?? 0) > 0 ? (
        <Card className="gap-2">
          <CardTitle>{pl.plan.sections.skipped}</CardTitle>
          {summary?.skipped.map((s) => (
            <Text key={s.slotId} className="text-sm leading-5">
              <Text className="font-display-semibold text-sm">
                {SLOT_BY_ID.get(s.slotId)?.name ?? s.slotId}
              </Text>
              {s.exerciseId ? ` (${nameOf(s.exerciseId)})` : ''}: {textOf(pl.plan.skip, s.reason)}
            </Text>
          ))}
        </Card>
      ) : null}

      <Card className="gap-3">
        <CardTitle>{pl.plan.sections.volume}</CardTitle>
        <Text variant="muted" className="text-sm">
          {pl.plan.sections.volumeHint(targets.weekly.min)}
        </Text>
        <VolumeMeter volume={volume} targets={targets} />
      </Card>
      <RecalculateButton today={today} />
    </ScrollView>
  );
}

/**
 * "Przelicz tydzień": the week planned again from scratch, with a loader —
 * then the banner on "Dziś" says what changed.
 */
function RecalculateButton({ today }: { today: ReturnType<typeof usePlanToday> }) {
  const [busy, setBusy] = useState(false);
  return (
    <View className="mt-2 gap-2">
      <Button
        variant="outline"
        label={busy ? pl.plan.recalculating : pl.plan.recalculate}
        icon={busy ? <ActivityIndicator /> : <RefreshCw size={16} className="text-foreground" />}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          void today.recalculate().finally(() => setBusy(false));
        }}
      />
      <Text variant="muted" className="text-center text-xs">
        {pl.plan.recalculateHint}
      </Text>
    </View>
  );
}
