import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { formatDecimal, NumberField, parseDecimal } from '@/components/ui/number-field';
import { Text } from '@/components/ui/text';
import { getWeightOnOrBefore, upsertEstimate } from '@/db/repositories/bodyMetrics';
import {
  getLatestMeasurement,
  getWaistSeries,
  upsertMeasurement,
  type MeasurementInput,
} from '@/db/repositories/measurements';
import { getProfile } from '@/db/repositories/profile';
import { navyBodyFatPct } from '@/domain/metrics/navy';
import { movingAverage, type SmoothedPoint } from '@/domain/metrics/series';
import { toIsoDate } from '@/domain/time/trainingDate';
import { TrendChart } from '@/features/body/TrendChart';
import { pl } from '@/strings/pl';

const FIELDS = ['waistCm', 'hipsCm', 'chestCm', 'armCm', 'thighCm', 'neckCm'] as const;
type Field = (typeof FIELDS)[number];

const LABELS: Record<Field, string> = {
  waistCm: pl.measurements.waist,
  hipsCm: pl.measurements.hips,
  chestCm: pl.measurements.chest,
  armCm: pl.measurements.arm,
  thighCm: pl.measurements.thigh,
  neckCm: pl.measurements.neck,
};

type Loaded = {
  today: string;
  lastDate: string | null;
  waist: SmoothedPoint[];
  profile: { heightCm: number | null; sex: 'male' | 'female' | null };
};

function isoDaysAgo(from: string, days: number): string {
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  return toIsoDate(new Date(y, m - 1, d - days));
}

export default function MeasurementsScreen() {
  const [data, setData] = useState<Loaded | null>(null);
  const [form, setForm] = useState<Record<Field, string>>({
    waistCm: '',
    hipsCm: '',
    chestCm: '',
    armCm: '',
    thighCm: '',
    neckCm: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const today = toIsoDate(new Date());
    const [latest, waist, profile] = await Promise.all([
      getLatestMeasurement(),
      getWaistSeries(isoDaysAgo(today, 90)),
      getProfile(),
    ]);
    setData({
      today,
      lastDate: latest?.date ?? null,
      waist: movingAverage(waist, 30, 1),
      profile: { heightCm: profile?.heightCm ?? null, sex: profile?.sex ?? null },
    });
    if (latest) {
      setForm((prev) => {
        const untouched = Object.values(prev).every((v) => v === '');
        if (!untouched) return prev;
        const next = { ...prev };
        for (const f of FIELDS) next[f] = formatDecimal(latest[f]);
        return next;
      });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const parsed = Object.fromEntries(FIELDS.map((f) => [f, parseDecimal(form[f])])) as Record<
    Field,
    number | null
  >;

  const navy = (() => {
    const { heightCm, sex } = data?.profile ?? {};
    if (!heightCm || !sex) return { kind: 'noProfile' as const };
    const { waistCm, neckCm, hipsCm } = parsed;
    if (waistCm === null || neckCm === null || (sex === 'female' && hipsCm === null)) {
      return { kind: 'noInputs' as const };
    }
    const pct =
      sex === 'male'
        ? navyBodyFatPct({ sex, heightCm, waistCm, neckCm })
        : navyBodyFatPct({ sex, heightCm, waistCm, neckCm, hipsCm: hipsCm! });
    return pct === null ? { kind: 'noInputs' as const } : { kind: 'ok' as const, pct };
  })();

  async function handleSave() {
    if (!data || saving) return;
    const values = parsed;
    const anyInvalid = FIELDS.some((f) => {
      const v = values[f];
      return v !== null && (v < 20 || v > 250);
    });
    if (anyInvalid) {
      setError(pl.measurements.invalid);
      return;
    }
    setError(null);
    setSaving(true);

    await upsertMeasurement(data.today, values as MeasurementInput);

    if (navy.kind === 'ok') {
      const weight = await getWeightOnOrBefore(data.today);
      if (weight) await upsertEstimate(data.today, 'navy', weight.weightKg, navy.pct);
    }

    await load();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
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
      <Stack.Screen options={{ title: pl.measurements.title }} />

      <Text variant="muted">{pl.measurements.intro}</Text>
      {data.lastDate ? (
        <Text variant="muted">{pl.measurements.lastEntry(data.lastDate)}</Text>
      ) : null}

      <Card>
        <CardContent>
          <View className="flex-row flex-wrap gap-3">
            {FIELDS.map((f) => (
              <NumberField
                key={f}
                label={LABELS[f]}
                value={form[f]}
                onChangeText={(t) => setForm((prev) => ({ ...prev, [f]: t }))}
                className="w-[47%]"
              />
            ))}
          </View>
          {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
          <Button label={pl.measurements.save} onPress={handleSave} disabled={saving} />
          {saved ? <Text variant="muted">{pl.measurements.saved}</Text> : null}
        </CardContent>
      </Card>

      <Card>
        <CardTitle>{pl.measurements.navyTitle}</CardTitle>
        <CardContent>
          {navy.kind === 'ok' ? (
            <Text variant="metric" className="text-3xl">
              {pl.measurements.navyValue(navy.pct)}
            </Text>
          ) : (
            <Text variant="muted">
              {navy.kind === 'noProfile'
                ? pl.measurements.navyMissingProfile
                : pl.measurements.navyMissingInputs}
            </Text>
          )}
          <CardDescription>{pl.measurements.navyCaveat}</CardDescription>
        </CardContent>
      </Card>

      <Card>
        <CardTitle>{pl.measurements.waistChartTitle}</CardTitle>
        <CardContent>
          <TrendChart
            points={data.waist}
            unit="cm"
            emptyText={pl.measurements.waistChartEmpty}
            minPoints={2}
          />
        </CardContent>
      </Card>
    </ScrollView>
  );
}
