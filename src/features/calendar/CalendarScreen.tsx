import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Bandage, RefreshCw } from '@/components/ui/icons';
import { PageHeader, StatusBarScrim } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { getCalendarRange, type CalendarData } from '@/db/repositories/calendar';
import { revokeConstraints, setDayTraining } from '@/db/repositories/constraints';
import { WEEK_CONFIG } from '@/domain/config/training';
import { addDays } from '@/domain/time/trainingDate';
import { PlanChangeBanner } from '@/features/plan/PlanChangeBanner';
import { usePlanToday } from '@/features/plan/usePlanToday';
import { useExerciseMap } from '@/features/workout/useExerciseMap';
import { useSessionOverview } from '@/features/workout/useSessionOverview';
import { pl } from '@/strings/pl';
import { CalendarDaySheet } from './CalendarDaySheet';
import { gridRange } from './dates';
import { MonthGrid } from './MonthGrid';

export function CalendarScreen() {
  const today = usePlanToday();
  const overview = useSessionOverview();
  const exerciseMap = useExerciseMap();
  const [month, setMonth] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const writeBusy = useRef(false);
  const requestId = useRef(0);
  const close = useCallback(() => setSelected(null), []);
  const asOf = today.state.status === 'ready' ? today.state.asOf : null;
  const visibleMonth = month ?? asOf?.slice(0, 7) ?? null;
  const loadRange = useCallback(
    async (cancelled: () => boolean = () => false) => {
      if (!visibleMonth) return;
      const id = ++requestId.current;
      const { from, until } = gridRange(visibleMonth);
      try {
        const rows = await getCalendarRange(from, until);
        if (id === requestId.current && !cancelled()) {
          setData(rows);
          setError(false);
        }
      } catch {
        if (id === requestId.current && !cancelled()) {
          setData(null);
          setError(true);
        }
      }
    },
    [visibleMonth],
  );
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (today.state.status === 'ready') void loadRange(() => cancelled);
      return () => {
        cancelled = true;
      };
    }, [loadRange, today.state]),
  );
  async function reload(request?: Parameters<typeof today.reload>[0]) {
    await today.reload(request);
    await overview.reload();
    await loadRange();
  }
  /** The day composed with the coach goes back to the engine, after a confirmation. */
  function restoreEngine(date: string, ids: string[]) {
    const t = pl.calendar.restoreConfirm;
    Alert.alert(t.title, t.body, [
      { text: t.cancel, style: 'cancel' },
      { text: t.confirm, onPress: () => void changeDay(date, () => revokeConstraints(ids)) },
    ]);
  }
  async function changeDay(date: string, write: () => Promise<void>) {
    if (writeBusy.current) return;
    writeBusy.current = true;
    setBusy(true);
    try {
      await write();
      // The week is planned again from that day, once; a failure there shows the plan's own retry.
      await reload({ trigger: 'constraint', from: date });
    } catch {
      await today.reload();
      Alert.alert(pl.calendar.saveError);
    } finally {
      writeBusy.current = false;
      setBusy(false);
    }
  }
  async function recalculate() {
    if (writeBusy.current) return;
    writeBusy.current = true;
    setBusy(true);
    try {
      await today.recalculate();
    } finally {
      writeBusy.current = false;
      setBusy(false);
    }
  }
  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerClassName="gap-4 px-5 pb-12">
        <PageHeader title={pl.calendar.title} subtitle={pl.calendar.subtitle} />
        <Link href="/plan/report" asChild>
          <Button
            label={pl.soreness.entry}
            variant="secondary"
            disabled={busy}
            icon={<Bandage size={18} className="text-foreground" />}
            onPress={close}
          />
        </Link>
        <Button
          label={busy ? pl.plan.recalculating : pl.plan.recalculate}
          variant="outline"
          icon={busy ? <ActivityIndicator /> : <RefreshCw size={16} className="text-foreground" />}
          disabled={busy || !asOf}
          onPress={() => void recalculate()}
        />
        {today.state.status === 'ready' && today.state.banner ? (
          <PlanChangeBanner
            expanded
            banner={today.state.banner}
            onClose={(id) => void today.dismissBanner(id)}
          />
        ) : null}
        {today.state.status === 'error' || error ? (
          <Card className="gap-3">
            <Text>{pl.plan.loadError}</Text>
            <Button label={pl.plan.retry} onPress={() => void reload()} />
          </Card>
        ) : asOf && visibleMonth && data ? (
          <Card className="p-2">
            <MonthGrid
              month={visibleMonth}
              asOf={asOf}
              horizon={addDays(asOf, WEEK_CONFIG.horizonDays - 1)}
              data={data}
              selected={selected}
              onSelect={setSelected}
              onMonth={(m) => {
                close();
                setData(null);
                setMonth(m);
              }}
            />
            <Button
              label={pl.calendar.today}
              variant="ghost"
              onPress={() => {
                setMonth(asOf.slice(0, 7));
                setSelected(asOf);
              }}
            />
          </Card>
        ) : (
          <ActivityIndicator className="my-12" />
        )}
      </ScrollView>
      {asOf && data && today.state.status === 'ready' ? (
        <CalendarDaySheet
          date={selected}
          asOf={asOf}
          data={data}
          todayPlan={today.state.plan}
          exerciseMap={exerciseMap}
          busy={busy}
          starting={today.starting}
          inProgressId={overview.data?.inProgress?.id ?? null}
          onClose={close}
          onReload={reload}
          onTraining={(date, train) => void changeDay(date, () => setDayTraining(date, train))}
          onRestore={restoreEngine}
          onStart={() => {
            close();
            void today.start();
          }}
          onResume={(id) => {
            close();
            overview.resume(id);
          }}
        />
      ) : null}
      <StatusBarScrim />
    </View>
  );
}
