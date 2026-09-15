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
import { movingAverage, round1, weeklyTrend, type SmoothedPoint } from '@/domain/metrics/series';
import { daysBetween, toIsoDate } from '@/domain/time/trainingDate';
import { TrendChart } from '@/features/body/TrendChart';
import { syncReminders } from '@/lib/reminders';
import { pl } from '@/strings/pl';

const CHART_DAYS = 60;

type Loaded = {
  today: string;
  todayWeight: number | null;
  latestWeight: number | null;
  series: SmoothedPoint[];
  average7: number | null;
  trend: number | null;
};

function isoDaysAgo(from: string, days: number): string {
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  return toIsoDate(new Date(y, m - 1, d - days));
}

export default function BodyScreen() {
  const [data, setData] = useState<Loaded | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const load = useCallback(async () => {
    const today = toIsoDate(new Date());
    const [todayRow, latestRow, raw] = await Promise.all([
      getWeightOn(today),
      getLatestWeight(),
      getWeightSeries(isoDaysAgo(today, CHART_DAYS)),
    ]);
    const series = movingAverage(raw, 7, 1);
    const strict = movingAverage(raw, 7, 3);
    const last = strict[strict.length - 1];
    setData({
      today,
      todayWeight: todayRow?.weightKg ?? null,
      latestWeight: latestRow?.weightKg ?? null,
      series,
      average7:
        last && last.average !== null && daysBetween(last.date, today) < 7
          ? round1(last.average)
          : null,
      trend: (() => {
        const t = weeklyTrend(raw);
        return t === null ? null : round1(t);
      })(),
    });
    setInput((prev) =>
      prev === '' ? formatDecimal(todayRow?.weightKg ?? latestRow?.weightKg) : prev,
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function handleSave() {
    if (!data || saving) return;
    const kg = parseDecimal(input);
    if (kg === null || kg < 30 || kg > 300) {
      setError(pl.body.invalidWeight);
      return;
    }
    setError(null);
    setSaving(true);
    await upsertWeight(data.today, round1(kg));
    await syncReminders();
    await load();
    setSaving(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2500);
  }

  if (!data) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-3 p-4 pb-10"
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <CardTitle>{pl.body.weightSection}</CardTitle>
        <CardContent>
          <View className="flex-row items-end gap-2">
            <NumberField
              label={pl.body.weightInputLabel}
              value={input}
              onChangeText={setInput}
              placeholder="82,5"
              className="flex-1"
            />
            <Button label={pl.body.weightSave} onPress={handleSave} disabled={saving} />
          </View>
          {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
          {savedFlash || data.todayWeight !== null ? (
            <Text variant="muted">{pl.body.weightSavedToday}</Text>
          ) : null}
          <View className="mt-1 flex-row flex-wrap gap-x-4">
            {data.average7 !== null ? (
              <Text variant="muted">{pl.today.average7(data.average7)}</Text>
            ) : null}
            {data.trend !== null ? (
              <Text variant="muted">{pl.today.trend(data.trend)}</Text>
            ) : (
              <Text variant="muted">{pl.body.noTrendYet}</Text>
            )}
          </View>
        </CardContent>
      </Card>

      <Card>
        <CardTitle>{pl.body.chartTitle}</CardTitle>
        <CardDescription>{pl.body.chartLegend}</CardDescription>
        <CardContent>
          <TrendChart points={data.series} unit="kg" emptyText={pl.body.chartEmpty} />
        </CardContent>
      </Card>

      <Link href="/body/measurements" asChild>
        <Card className="active:opacity-70">
          <CardTitle>{pl.body.measurementsLink}</CardTitle>
          <CardDescription>{pl.body.measurementsHint}</CardDescription>
        </Card>
      </Link>

      <Link href="/body/daily" asChild>
        <Card className="active:opacity-70">
          <CardTitle>{pl.body.dailyLink}</CardTitle>
          <CardDescription>{pl.body.dailyHint}</CardDescription>
        </Card>
      </Link>
    </ScrollView>
  );
}
