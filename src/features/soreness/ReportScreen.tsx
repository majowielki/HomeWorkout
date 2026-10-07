import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { getDayBoundaryHour } from '@/db/repositories/profile';
import { getActiveConstraints } from '@/db/repositories/weekPlan';
import type { PlanConstraint } from '@/domain/plan/constraints';
import type { SorenessReport } from '@/domain/plan/sorenessReport';
import { trainingDate } from '@/domain/time/trainingDate';
import { pl } from '@/strings/pl';

import { ReportDateChangedError, saveSorenessReport, withdrawSorenessReport } from './actions';
import { ActiveReports } from './ActiveReports';
import { SorenessForm } from './SorenessForm';

type Data = { asOf: string; constraints: PlanConstraint[] };
type State = { status: 'loading' } | { status: 'error' } | ({ status: 'ready' } & Data);

export function ReportScreen() {
  const t = pl.soreness;
  const router = useRouter();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const guard = useRef(false);
  const load = useCallback(async (cancelled: () => boolean = () => false) => {
    try {
      const asOf = trainingDate(new Date(), await getDayBoundaryHour());
      const constraints = await getActiveConstraints(asOf);
      if (!cancelled()) setState({ status: 'ready', asOf, constraints });
    } catch {
      if (!cancelled()) setState({ status: 'error' });
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void load(() => cancelled);
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  async function save(report: SorenessReport) {
    if (guard.current || state.status !== 'ready') return;
    guard.current = true;
    setBusy(true);
    try {
      const { decision, planUpdated } = await saveSorenessReport(report, state.asOf);
      setMessage(!planUpdated ? t.updateFailed : decision.kind === 'mild' ? t.mildSaved : t.saved);
      setShowForm(false);
      await load();
    } catch (e) {
      if (e instanceof ReportDateChangedError) {
        await load();
        Alert.alert(t.dateChanged);
      } else Alert.alert(t.saveFailed);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (guard.current || state.status !== 'ready') return;
    guard.current = true;
    setBusy(true);
    try {
      const { planUpdated } = await withdrawSorenessReport(id, state.asOf);
      setMessage(planUpdated ? t.withdrawn : t.withdrawalUpdateFailed);
      await load();
    } catch {
      Alert.alert(t.saveFailed);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-5 pb-12 pt-4"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t.title, presentation: 'modal' }} />
      {message ? (
        <Card className="gap-2 border-primary">
          <Text>{message}</Text>
        </Card>
      ) : null}
      {state.status === 'loading' ? (
        <ActivityIndicator />
      ) : state.status === 'error' ? (
        <View className="gap-3">
          <Text>{t.loadFailed}</Text>
          <Button label={pl.plan.retry} onPress={() => void load()} />
        </View>
      ) : (
        <>
          {showForm ? (
            <SorenessForm asOf={state.asOf} busy={busy} onSubmit={(report) => void save(report)} />
          ) : (
            <Button
              label={t.newReport}
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setMessage(null);
                setShowForm(true);
              }}
            />
          )}
          <ActiveReports
            asOf={state.asOf}
            constraints={state.constraints}
            busy={busy}
            onRevoke={(id) => void revoke(id)}
          />
        </>
      )}
      <Button
        variant="outline"
        label={t.calendar}
        disabled={busy}
        onPress={() => router.dismissTo('/(tabs)/workout')}
      />
    </ScrollView>
  );
}
