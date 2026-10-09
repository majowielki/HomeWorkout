import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardEyebrow } from '@/components/ui/card';
import { Activity, ArrowRight, type LucideIcon, Moon, Play, Zap } from '@/components/ui/icons';
import { formatDecimal, NumberField, parseDecimal } from '@/components/ui/number-field';
import { PageHeader, StatusBarScrim } from '@/components/ui/page-header';
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
import { WeightTrendBadge } from '@/features/body/WeightTrendBadge';
import { workoutTitle } from '@/features/history/workoutTitle';
import { PlanHero } from '@/features/plan/PlanHero';
import { RideCard } from '@/features/plan/RideCard';
import { usePlanToday } from '@/features/plan/usePlanToday';
import { SessionHero } from '@/features/workout/SessionHero';
import { useExerciseMap } from '@/features/workout/useExerciseMap';
import { useSessionOverview } from '@/features/workout/useSessionOverview';
import { formatDate } from '@/lib/format';
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
 * The one screen opened every day. Three blocks, each answering a single
 * question: what is my next session, what do I weigh, how do I feel.
 * The session leads — it is the only one that asks for real effort.
 * See Documents/IMPLEMENTACJA.md §2.2 and §10.1.
 */
export default function TodayScreen() {
  const session = useSessionOverview();
  const today = usePlanToday();
  const exerciseMap = useExerciseMap();
  const [body, setBody] = useState<BodyState | null>(null);
  const [daily, setDaily] = useState<DailyState | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const [weightError, setWeightError] = useState<string | null>(null);
  const [savingWeight, setSavingWeight] = useState(false);
  const [hour, setHour] = useState(12);

  const load = useCallback(async () => {
    const now = new Date();
    const today = toIsoDate(now);
    const [todayRow, latestRow, raw, dailyRow] = await Promise.all([
      getWeightOn(today),
      getLatestWeight(),
      getWeightSeries(addDays(today, -28)),
      getDailyLog(today),
    ]);
    const summary = summarizeWeight(raw, today);
    setHour(now.getHours());
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

  const { inProgress } = session.data;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        <PageHeader eyebrow={formatDate(body.today, 'long')} title={pl.today.greeting(hour)} />

        {inProgress ? (
          <SessionHero
            eyebrow={pl.today.inProgressEyebrow}
            title={workoutTitle(inProgress)}
            badge={pl.history.status.in_progress}
            plan={inProgress.sessionPlan ?? undefined}
            exerciseMap={exerciseMap}
          >
            <Button
              size="lg"
              label={pl.workout.resume}
              icon={<Play size={18} className="text-primary-foreground" />}
              onPress={() => session.resume(inProgress.id)}
            />
          </SessionHero>
        ) : (
          <PlanHero today={today} exerciseMap={exerciseMap} />
        )}

        {today.state.status === 'ready' ? (
          <RideCard key={today.state.asOf} asOf={today.state.asOf} ride={today.state.bike} />
        ) : null}

        <Card className="gap-4">
          <View className="flex-row items-center justify-between">
            <CardEyebrow className="mb-0">{pl.today.weightCard}</CardEyebrow>
            {body.trend !== null ? <WeightTrendBadge kgPerWeek={body.trend} /> : null}
          </View>

          {body.todayWeight !== null ? (
            <View className="flex-row items-baseline gap-2">
              <Text variant="metric" className="text-6xl leading-[68px]">
                {formatDecimal(body.todayWeight)}
              </Text>
              <Text className="font-display-medium text-xl text-muted-foreground">
                {pl.today.kg}
              </Text>
              <Text variant="muted" className="ml-auto">
                {pl.today.loggedToday}
              </Text>
            </View>
          ) : (
            <View className="flex-row items-end gap-2">
              <NumberField
                accessibilityLabel={pl.today.logWeightToday}
                className="flex-1"
                inputClassName="h-14 font-display-semibold text-2xl"
                value={weightInput}
                onChangeText={setWeightInput}
                placeholder={pl.body.weightPlaceholder}
              />
              <Button
                label={pl.body.weightSave}
                variant="inverse"
                className="h-14"
                onPress={handleSaveWeight}
                disabled={savingWeight}
              />
            </View>
          )}
          {weightError ? <Text className="text-sm text-destructive">{weightError}</Text> : null}

          <View className="flex-row gap-3">
            <MiniStat
              label={pl.today.average7Label}
              value={
                body.average7 !== null
                  ? `${formatDecimal(body.average7)} ${pl.today.kg}`
                  : pl.today.noValue
              }
            />
            <MiniStat
              label={pl.today.trendLabel}
              value={body.trend !== null ? pl.today.trendValue(body.trend) : pl.today.noValue}
            />
          </View>
          {body.latestWeight === null ? <Text variant="muted">{pl.today.noWeightYet}</Text> : null}
        </Card>

        <Link href="/body/daily" asChild>
          <Pressable className="active:opacity-80">
            <Card className="gap-4">
              <View className="flex-row items-center justify-between">
                <CardEyebrow className="mb-0">{pl.today.dailyCard}</CardEyebrow>
                <View className="flex-row items-center gap-1">
                  <Text className="font-display-semibold text-sm text-highlight">
                    {daily.exists ? pl.today.editDaily : pl.today.fillDaily}
                  </Text>
                  <ArrowRight size={16} className="text-highlight" />
                </View>
              </View>
              {daily.exists ? (
                <View className="flex-row gap-3">
                  <DailyStat
                    icon={Moon}
                    label={pl.today.sleepLabel}
                    value={daily.sleep !== null ? pl.today.hours(daily.sleep) : pl.today.noValue}
                  />
                  <DailyStat
                    icon={Zap}
                    label={pl.today.energyLabel}
                    value={
                      daily.energy !== null ? pl.today.outOfFive(daily.energy) : pl.today.noValue
                    }
                  />
                  <DailyStat
                    icon={Activity}
                    label={pl.today.sorenessLabel}
                    value={String(daily.soreCount)}
                  />
                </View>
              ) : (
                <Text className="font-display-medium text-lg leading-6 text-card-foreground">
                  {pl.today.dailyEmpty}
                </Text>
              )}
            </Card>
          </Pressable>
        </Link>
      </ScrollView>
      <StatusBarScrim />
    </View>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 gap-1 rounded-2xl bg-secondary px-4 py-3">
      <Text variant="muted" className="text-xs">
        {label}
      </Text>
      <Text className="font-display-semibold text-base text-secondary-foreground">{value}</Text>
    </View>
  );
}

function DailyStat({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <View className="flex-1 gap-2 rounded-2xl bg-secondary p-3">
      <Icon size={18} className="text-highlight" />
      <View>
        <Text className="font-display text-xl tabular-nums text-secondary-foreground">{value}</Text>
        <Text variant="muted" className="text-xs">
          {label}
        </Text>
      </View>
    </View>
  );
}
