import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Stepper } from '@/components/ui/stepper';
import { Text } from '@/components/ui/text';
import { getDailyLog, upsertDailyLog } from '@/db/repositories/dailyLogs';
import { toIsoDate } from '@/domain/time/trainingDate';
import type { MuscleGroup } from '@/domain/types';
import { pl } from '@/strings/pl';

const SCALE = [1, 2, 3, 4, 5] as const;

/** Order matches how the body is scanned for soreness: legs first, then trunk, then arms. */
const MUSCLES: MuscleGroup[] = [
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'back',
  'lats',
  'chest',
  'core',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
];

/**
 * Soreness is a three-state cycle per muscle: none -> 2 -> 4 -> none.
 * The engine's rule (SPEC §4.3) treats DOMS >= 4 as "skip this muscle
 * today", so the two levels map directly onto "mild" and "strong".
 */
const SORENESS_CYCLE = [0, 2, 4] as const;

export default function DailyLogScreen() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [today, setToday] = useState('');
  const [sleep, setSleep] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [stress, setStress] = useState<number | null>(null);
  const [soreness, setSoreness] = useState<Partial<Record<MuscleGroup, number>>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const date = toIsoDate(new Date());
      getDailyLog(date).then((row) => {
        if (cancelled) return;
        setToday(date);
        setSleep(row?.sleepHours ?? null);
        setEnergy(row?.energy ?? null);
        setStress(row?.stress ?? null);
        setSoreness(row?.soreness ?? {});
        setNote(row?.note ?? '');
        setLoaded(true);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  function cycleSoreness(muscle: MuscleGroup) {
    setSoreness((prev) => {
      const current = prev[muscle] ?? 0;
      const idx = SORENESS_CYCLE.indexOf(current as (typeof SORENESS_CYCLE)[number]);
      const next = SORENESS_CYCLE[(idx + 1) % SORENESS_CYCLE.length]!;
      const copy = { ...prev };
      if (next === 0) delete copy[muscle];
      else copy[muscle] = next;
      return copy;
    });
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    await upsertDailyLog(today, {
      sleepHours: sleep,
      energy,
      stress,
      soreness: Object.keys(soreness).length > 0 ? soreness : null,
      note: note.trim().length > 0 ? note.trim() : null,
    });
    setSaving(false);
    router.back();
  }

  if (!loaded) {
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
      <Stack.Screen options={{ title: pl.daily.title }} />

      <Card>
        <CardContent className="items-center">
          <Stepper
            label={pl.daily.sleep}
            value={sleep === null ? '—' : String(sleep).replace('.', ',')}
            onDecrement={() => setSleep((s) => Math.max(0, (s ?? 7) - 0.5))}
            onIncrement={() => setSleep((s) => Math.min(14, (s ?? 6.5) + 0.5))}
          />
        </CardContent>
      </Card>

      <ScaleCard
        title={pl.daily.energy}
        low={pl.daily.scaleLow}
        high={pl.daily.scaleHigh}
        value={energy}
        onChange={setEnergy}
      />
      <ScaleCard
        title={pl.daily.stress}
        low={pl.daily.stressLow}
        high={pl.daily.stressHigh}
        value={stress}
        onChange={setStress}
      />

      <Card>
        <CardTitle>{pl.daily.soreness}</CardTitle>
        <Text variant="muted" className="mb-2">
          {pl.daily.sorenessHint}
        </Text>
        <CardContent className="flex-row flex-wrap gap-2">
          {MUSCLES.map((m) => {
            const level = soreness[m] ?? 0;
            const suffix =
              level >= 4
                ? ` · ${pl.daily.sorenessStrong}`
                : level > 0
                  ? ` · ${pl.daily.sorenessMild}`
                  : '';
            return (
              <Chip
                key={m}
                label={`${pl.labels.muscle[m]}${suffix}`}
                selected={level > 0}
                onPress={() => cycleSoreness(m)}
                className={level >= 4 ? 'border-destructive bg-destructive' : undefined}
              />
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardTitle>{pl.daily.note}</CardTitle>
        <CardContent>
          <Input
            value={note}
            onChangeText={setNote}
            placeholder={pl.daily.notePlaceholder}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            className="h-auto min-h-[72px] py-3"
          />
        </CardContent>
      </Card>

      <Button label={pl.daily.save} size="lg" onPress={handleSave} disabled={saving} />
    </ScrollView>
  );
}

function ScaleCard({
  title,
  low,
  high,
  value,
  onChange,
}: {
  title: string;
  low: string;
  high: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <CardContent>
        <View className="flex-row justify-between gap-2">
          {SCALE.map((v) => (
            <Chip
              key={v}
              label={String(v)}
              selected={value === v}
              onPress={() => onChange(v)}
              className="flex-1"
            />
          ))}
        </View>
        <View className="flex-row justify-between">
          <Text variant="muted" className="text-xs">
            {low}
          </Text>
          <Text variant="muted" className="text-xs">
            {high}
          </Text>
        </View>
      </CardContent>
    </Card>
  );
}
