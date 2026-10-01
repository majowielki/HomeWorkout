import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardEyebrow } from '@/components/ui/card';
import { HeroGlow } from '@/components/ui/hero-glow';
import { Check, Moon, Ruler } from '@/components/ui/icons';
import { ListRow } from '@/components/ui/list-row';
import { formatDecimal, NumberField, parseDecimal } from '@/components/ui/number-field';
import { PageHeader, StatusBarScrim } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import {
  getLatestWeight,
  getWeightOn,
  getWeightSeries,
  upsertWeight,
} from '@/db/repositories/bodyMetrics';
import {
  movingAverage,
  round1,
  type SmoothedPoint,
  summarizeWeight,
} from '@/domain/metrics/series';
import { addDays, toIsoDate } from '@/domain/time/trainingDate';
import { TrendChart } from '@/features/body/TrendChart';
import { WeightTrendBadge } from '@/features/body/WeightTrendBadge';
import { formatDate } from '@/lib/format';
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
      getWeightSeries(addDays(today, -CHART_DAYS)),
    ]);
    // The chart draws its line from the first entry (minPoints = 1); the
    // headline average is stricter — see IMPLEMENTACJA §0.2.
    const summary = summarizeWeight(raw, today);
    setData({
      today,
      todayWeight: todayRow?.weightKg ?? null,
      latestWeight: latestRow?.weightKg ?? null,
      series: movingAverage(raw, 7, 1),
      average7: summary.average,
      trend: summary.trend,
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
    try {
      await upsertWeight(data.today, round1(kg));
      await syncReminders();
      await load();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        <PageHeader eyebrow={formatDate(data.today, 'long')} title={pl.body.title} />

        <Card variant="inverse" className="gap-5 p-6">
          <HeroGlow />
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow" className="text-inverse-muted">
              {pl.body.weightSection}
            </Text>
            {data.trend !== null ? <WeightTrendBadge kgPerWeek={data.trend} /> : null}
          </View>
          <View className="flex-row items-baseline gap-2">
            <Text variant="metric" className="text-7xl leading-[80px] text-inverse-foreground">
              {data.latestWeight !== null ? formatDecimal(data.latestWeight) : pl.today.noValue}
            </Text>
            <Text className="font-display-medium text-2xl text-inverse-muted">{pl.today.kg}</Text>
          </View>
          <View className="flex-row gap-6">
            <HeroStat
              label={pl.today.average7Label}
              value={
                data.average7 !== null
                  ? `${formatDecimal(data.average7)} ${pl.today.kg}`
                  : pl.today.noValue
              }
            />
            <HeroStat
              label={pl.today.trendLabel}
              value={data.trend !== null ? pl.today.trendValue(data.trend) : pl.today.noValue}
            />
          </View>
          {data.trend === null ? (
            <Text className="text-sm text-inverse-muted">{pl.body.noTrendYet}</Text>
          ) : null}
        </Card>

        <Card className="gap-3">
          <CardEyebrow className="mb-0">{pl.body.weightInputLabel}</CardEyebrow>
          <View className="flex-row items-center gap-2">
            <NumberField
              accessibilityLabel={pl.body.weightInputLabel}
              value={input}
              onChangeText={setInput}
              placeholder="82,5"
              className="flex-1"
              inputClassName="h-14 font-display-semibold text-2xl"
            />
            <Button
              label={pl.body.weightSave}
              variant="inverse"
              className="h-14"
              onPress={handleSave}
              disabled={saving}
            />
          </View>
          {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
          {savedFlash || data.todayWeight !== null ? (
            <View className="flex-row items-center gap-1.5">
              <Check size={14} className="text-highlight" />
              <Text variant="muted" className="flex-1">
                {pl.body.weightSavedToday}
              </Text>
            </View>
          ) : null}
        </Card>

        <Card className="gap-1">
          <CardEyebrow>{pl.body.chartTitle}</CardEyebrow>
          <CardDescription>{pl.body.chartLegend}</CardDescription>
          <CardContent className="mt-3">
            <TrendChart points={data.series} unit="kg" emptyText={pl.body.chartEmpty} />
          </CardContent>
        </Card>

        <Text variant="eyebrow" className="mt-2">
          {pl.body.trackingEyebrow}
        </Text>
        <Card className="py-1">
          <Link href="/body/measurements" asChild>
            <ListRow
              icon={Ruler}
              title={pl.body.measurementsLink}
              subtitle={pl.body.measurementsHint}
            />
          </Link>
          <Link href="/body/daily" asChild>
            <ListRow icon={Moon} title={pl.body.dailyLink} subtitle={pl.body.dailyHint} divider />
          </Link>
        </Card>
      </ScrollView>
      <StatusBarScrim />
    </View>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-0.5">
      <Text className="text-xs text-inverse-muted">{label}</Text>
      <Text className="font-display-semibold text-base text-inverse-foreground">{value}</Text>
    </View>
  );
}
