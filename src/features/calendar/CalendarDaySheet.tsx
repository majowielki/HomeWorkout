import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Bike, X } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { CalendarData } from '@/db/repositories/calendar';
import type { SessionPlanV2 } from '@/domain/plan/planV2';
import { labelsOf } from '@/domain/session/progress';
import { workoutTitle } from '@/features/history/workoutTitle';
import type { Exercise } from '@/domain/types';
import { planTitle } from '@/features/plan/format';
import { QuickCardioForm } from '@/features/workout/QuickCardioForm';
import { formatDate } from '@/lib/format';
import { calendarDay } from './dayView';
import { useThemeColors } from '@/lib/theme';
import { pl } from '@/strings/pl';

type Props = {
  date: string | null;
  asOf: string;
  data: CalendarData;
  todayPlan: SessionPlanV2 | null;
  exerciseMap: Record<string, Exercise>;
  busy: boolean;
  starting: boolean;
  inProgressId: string | null;
  onClose: () => void;
  onReload: () => Promise<void>;
  onTraining: (date: string, train: boolean) => void;
  /** Takes back the compose_day requests of a day composed with the coach. */
  onRestore: (date: string, ids: string[]) => void;
  onStart: () => void;
  onResume: (id: string) => void;
};

export function CalendarDaySheet(props: Props) {
  const {
    date,
    asOf,
    data,
    todayPlan,
    exerciseMap,
    busy,
    starting,
    inProgressId,
    onClose,
    onReload,
    onTraining,
    onRestore,
    onStart,
    onResume,
  } = props;
  const colors = useThemeColors();
  const ref = useRef<BottomSheet>(null);
  const [quickCardio, setQuickCardio] = useState(false);
  useEffect(() => {
    if (date) ref.current?.snapToIndex(0);
    else ref.current?.close();
  }, [date]);
  useFocusEffect(
    useCallback(() => {
      if (!date) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        onClose();
        return true;
      });
      return () => sub.remove();
    }, [date, onClose]),
  );
  const backdrop = useCallback(
    (p: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...p} appearsOnIndex={0} disappearsOnIndex={-1} />
    ),
    [],
  );
  const { day, sessions, rides, diary, completed, plan, editable, composedIds } = calendarDay(
    data,
    date,
    asOf,
    todayPlan,
  );
  const labels = plan ? labelsOf(plan) : [];
  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={['85%']}
      enableDynamicSizing={false}
      enablePanDownToClose
      backdropComponent={backdrop}
      onClose={() => {
        setQuickCardio(false);
        onClose();
      }}
      backgroundStyle={{ backgroundColor: colors.card }}
      handleIndicatorStyle={{ backgroundColor: colors.mutedForeground }}
    >
      {date ? (
        <BottomSheetScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 36, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-row items-center gap-3">
            <Text variant="heading" className="flex-1">
              {formatDate(date, 'long')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={pl.calendar.close}
              onPress={onClose}
              hitSlop={12}
            >
              <X size={22} className="text-muted-foreground" />
            </Pressable>
          </View>
          {day?.status === 'missed' ? (
            <Text className="text-destructive">{pl.calendar.missed}</Text>
          ) : null}
          {sessions.map(({ workout: w, sets }) => (
            <Link key={w.id} href={{ pathname: '/history/[id]', params: { id: w.id } }} asChild>
              <Pressable className="gap-1 rounded-2xl border border-border p-4" onPress={onClose}>
                <Text className="font-display-semibold">{workoutTitle(w)}</Text>
                <Text variant="muted">
                  {w.status === 'completed' ? pl.calendar.completed : pl.history.status[w.status]} ·{' '}
                  {pl.history.sets(sets)}
                </Text>
              </Pressable>
            </Link>
          ))}
          {rides.map((r) => (
            <Text key={r.id}>
              {pl.calendar.ride(r.minutes)}
              {r.resistanceLevel !== null
                ? ` · ${pl.workout.cardio.resistance} ${r.resistanceLevel}`
                : ''}
              {r.rpe !== null ? ` · RPE ${r.rpe}` : ''}
            </Text>
          ))}
          {diary ? (
            <Card className="gap-2">
              <Text variant="eyebrow">{pl.calendar.diary}</Text>
              <Text>
                {pl.today.dailySummary(
                  diary.sleepHours,
                  diary.energy,
                  Object.keys(diary.soreness ?? {}).length,
                )}
              </Text>
              {diary.soreness ? (
                <Text variant="muted">
                  {Object.entries(diary.soreness)
                    .map(
                      ([m, n]) => `${pl.labels.muscle[m as keyof typeof pl.labels.muscle]} ${n}/5`,
                    )
                    .join(' · ')}
                </Text>
              ) : null}
              {diary.note ? <Text>{diary.note}</Text> : null}
            </Card>
          ) : null}
          {date < asOf && !sessions.length && !rides.length ? (
            <Text variant="muted">{pl.calendar.empty}</Text>
          ) : null}
          {date >= asOf && !completed ? (
            <View className="gap-3">
              <Text variant="eyebrow">
                {plan
                  ? composedIds.length > 0
                    ? `${pl.calendar.planned} · ${pl.calendar.composed}`
                    : pl.calendar.planned
                  : day?.selection === null
                    ? pl.calendar.rest
                    : pl.calendar.noPlan}
              </Text>
              {plan ? (
                <>
                  <Text variant="title">{planTitle(plan)}</Text>
                  <Text variant="muted">
                    {pl.plan.meta(Math.ceil(plan.time.exerciseTotal / 60))}
                  </Text>
                  {date > asOf ? (
                    <Text variant="muted" className="text-sm">
                      {pl.calendar.forecastHint}
                    </Text>
                  ) : null}
                  {plan.exposures.map((e, i) => (
                    <Text key={e.id}>
                      {labels[i]} · {exerciseMap[e.exercise.id]?.name ?? e.exercise.displayName} ·{' '}
                      {pl.calendar.sets(
                        new Set(e.sets.map((s) => s.logicalSetId)).size,
                        exerciseMap[e.exercise.id]?.sides === 'perSet',
                      )}
                    </Text>
                  ))}
                  <Text>
                    {pl.plan.bikeLine(
                      day?.summary?.bike?.minutes ?? Math.round(plan.time.bike / 60),
                      null,
                    )}
                  </Text>
                  <Link href={{ pathname: '/plan', params: { date } }} asChild>
                    <Button label={pl.calendar.details} variant="outline" onPress={onClose} />
                  </Link>
                </>
              ) : null}
            </View>
          ) : null}
          {date === asOf ? (
            <>
              {inProgressId ? (
                <Button label={pl.workout.resume} onPress={() => onResume(inProgressId)} />
              ) : plan && !completed ? (
                <Button label={pl.plan.start} disabled={starting || busy} onPress={onStart} />
              ) : null}
              {quickCardio ? (
                <QuickCardioForm
                  key={date}
                  trainingDate={date}
                  onCancel={() => setQuickCardio(false)}
                  onLogged={() => {
                    setQuickCardio(false);
                    void onReload();
                  }}
                />
              ) : (
                <Button
                  label={pl.workout.quickCardio}
                  variant="outline"
                  icon={<Bike size={18} className="text-foreground" />}
                  onPress={() => setQuickCardio(true)}
                />
              )}
              {!inProgressId && completed ? (
                <Link href="/plan/extra" asChild>
                  <Button
                    label={pl.extra.title}
                    variant="outline"
                    disabled={starting || busy}
                    onPress={onClose}
                  />
                </Link>
              ) : null}
            </>
          ) : null}
          {editable && plan && composedIds.length > 0 ? (
            <View className="gap-2">
              <Button
                label={pl.calendar.restoreEngine}
                variant="outline"
                disabled={busy || starting || inProgressId !== null}
                onPress={() => onRestore(date, composedIds)}
              />
              <Text variant="muted" className="text-xs">
                {pl.calendar.restoreHint}
              </Text>
            </View>
          ) : null}
          {editable ? (
            <View className="gap-2">
              <Button
                label={!plan ? pl.calendar.trainAction : pl.calendar.restAction}
                variant="outline"
                disabled={busy || starting || inProgressId !== null}
                onPress={() => onTraining(date, !plan)}
              />
              <Text variant="muted" className="text-xs">
                {pl.calendar.changeHint}
              </Text>
            </View>
          ) : null}
        </BottomSheetScrollView>
      ) : null}
    </BottomSheet>
  );
}
