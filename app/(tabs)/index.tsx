import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { formatDecimal, NumberField, parseDecimal } from '@/components/ui/number-field';
import { Text } from '@/components/ui/text';
import {
  getLatestWeight,
  getWeightOn,
  getWeightSeries,
  upsertWeight,
} from '@/db/repositories/bodyMetrics';
import { getDailyLog } from '@/db/repositories/dailyLogs';
import { round1, summarizeWeight } from '@/domain/metrics/series';
import { addDays, toIsoDate } from '@/domain/time/trainingDate';
import { useSessionOverview } from '@/features/workout/useSessionOverview';
import { syncReminders } from '@/lib/reminders';
import { pl } from '@/strings/pl';

type BodyState = {
  today: string;
  todayWeight: number | null;
  latestWeight: number | null;
  average7: number | null;
  trend: number | null;
};

type DailyState = {
  exists: boolean;
  sleep: number | null;
  energy: number | null;
  soreCount: number;
};

/**
 * The one screen opened every day. Three cards, each answering a single
 * question: what do I weigh, what is my next session, how do I feel.
 * See Documents/IMPLEMENTACJA.md §2.2 and §10.1.
 */
export default function TodayScreen() {
  const session = useSessionOverview();
  const [body, setBody] = useState<BodyState | null>(null);
  const [daily, setDaily] = useState<DailyState | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const [weightError, setWeightError] = useState<string | null>(null);
  const [savingWeight, setSavingWeight] = useState(false);

  const load = useCallback(async () => {
    const today = toIsoDate(new Date());
    const [todayRow, latestRow, raw, dailyRow] = await Promise.all([
      getWeightOn(today),
      getLatestWeight(),
      getWeightSeries(addDays(today, -28)),
      getDailyLog(today),
    ]);
    const summary = summarizeWeight(raw, today);
    setBody({
      today,
      todayWeight: todayRow?.weightKg ?? null,
      latestWeight: latestRow?.weightKg ?? null,
      average7: summary.average,
      trend: summary.trend,
    });
    setDaily({
      exists: dailyRow !== null,
      sleep: dailyRow?.sleepHours ?? null,
      energy: dailyRow?.energy ?? null,
      soreCount: Object.keys(dailyRow?.soreness ?? {}).length,
    });
    setWeightInput((prev) => (prev === '' ? formatDecimal(latestRow?.weightKg) : prev));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function handleSaveWeight() {
    if (!body || savingWeight) return;
    const kg = parseDecimal(weightInput);
    if (kg === null || kg < 30 || kg > 300) {
      setWeightError(pl.body.invalidWeight);
      return;
    }
    setWeightError(null);
    setSavingWeight(true);
    try {
      await upsertWeight(body.today, round1(kg));
      await syncReminders();
      await load();
    } finally {
      setSavingWeight(false);
    }
  }

  if (!body || !daily || !session.data) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  const { inProgress, suggested, lastTemplateName, lastSessionDaysAgo } = session.data;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-3 p-4 pb-10"
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <CardTitle>{pl.today.weightCard}</CardTitle>
        <CardContent>
          {body.todayWeight !== null ? (
            <Text variant="metric" className="text-3xl">
              {pl.today.weightLoggedToday(body.todayWeight)}
            </Text>
          ) : (
            <View className="flex-row items-end gap-2">
              <NumberField
                label={pl.today.logWeightToday}
                value={weightInput}
                onChangeText={setWeightInput}
                placeholder="82,5"
                className="flex-1"
              />
              <Button
                label={pl.body.weightSave}
                onPress={handleSaveWeight}
                disabled={savingWeight}
              />
            </View>
          )}
          {weightError ? <Text className="text-sm text-destructive">{weightError}</Text> : null}
          <View className="flex-row flex-wrap gap-x-4">
            {body.average7 !== null ? (
              <Text variant="muted">{pl.today.average7(body.average7)}</Text>
            ) : body.latestWeight === null ? (
              <Text variant="muted">{pl.today.noWeightYet}</Text>
            ) : null}
            {body.trend !== null ? <Text variant="muted">{pl.today.trend(body.trend)}</Text> : null}
          </View>
        </CardContent>
      </Card>

      <Card className={inProgress ? 'border-primary/40 bg-primary/5' : undefined}>
        <CardTitle>{pl.today.sessionCard}</CardTitle>
        <CardContent>
          {inProgress ? (
            <>
              <CardDescription>
                {pl.workout.resumeBanner(
                  session.data.templates.find((t) => t.id === inProgress.templateId)?.name ?? '',
                )}
              </CardDescription>
              <Button label={pl.workout.resume} onPress={() => session.resume(inProgress.id)} />
            </>
          ) : (
            <>
              <CardDescription>
                {lastSessionDaysAgo === null
                  ? pl.workout.noSessionsYet
                  : `${pl.workout.lastSession(lastSessionDaysAgo)}${lastTemplateName ? ` · ${lastTemplateName}` : ''}`}
              </CardDescription>
              {suggested ? (
                <>
                  <Text variant="muted">{pl.today.nextTemplate(suggested.name)}</Text>
                  <Button
                    label={pl.today.startNext(suggested.name)}
                    onPress={() => session.start(suggested.id)}
                    disabled={session.starting}
                  />
                </>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Link href="/body/daily" asChild>
        <Card className="active:opacity-70">
          <CardTitle>{pl.today.dailyCard}</CardTitle>
          <CardDescription>
            {daily.exists
              ? pl.today.dailySummary(daily.sleep, daily.energy, daily.soreCount)
              : pl.today.dailyEmpty}
          </CardDescription>
          <Text className="mt-1 text-primary">
            {daily.exists ? pl.today.editDaily : pl.today.fillDaily}
          </Text>
        </Card>
      </Link>
    </ScrollView>
  );
}
