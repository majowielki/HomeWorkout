import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { formatDecimal, NumberField, parseDecimal } from '@/components/ui/number-field';
import { Text } from '@/components/ui/text';
import { type BandRow, getBand, saveCalibration } from '@/db/repositories/bands';
import { LADDER_SINGLE, nextRung } from '@/domain/inventory';
import {
  estimateBandLoad,
  fitCalibration,
  stretchHasPlateaued,
} from '@/domain/progression/calibration';
import type { AnchorPosition, BandCalibrationPoint } from '@/domain/types';
import { pl } from '@/strings/pl';

const PREVIEW_ROM_CM = 40;
const POSITIONS: AnchorPosition[] = [0, 1, 2, 3];

type Step = 'rest' | 'points' | 'result';

/**
 * SPEC §5.5 as a three-step form: rest length, one (mass, length) pair
 * per rung of the single-dumbbell ladder, then the fit with its reason.
 * The green band is expected to end at NO_STRETCH — the screen says so
 * instead of pretending.
 */
export default function BandCalibrationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [band, setBand] = useState<BandRow | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getBand(id).then((row) => {
      if (!cancelled) setBand(row);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (band === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: '' }} />
        <ActivityIndicator />
      </View>
    );
  }
  if (band === null) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: '' }} />
        <Text variant="muted">{pl.bands.wizard.notFound}</Text>
      </View>
    );
  }
  return <Wizard band={band} />;
}

function Wizard({ band }: { band: BandRow }) {
  const router = useRouter();
  const w = pl.bands.wizard;

  const [step, setStep] = useState<Step>('rest');
  const [restInput, setRestInput] = useState(formatDecimal(band.calibration?.restLengthCm));
  const [restLengthCm, setRestLengthCm] = useState<number | null>(null);
  const [points, setPoints] = useState<BandCalibrationPoint[]>([]);
  const [lengthInput, setLengthInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nextMass =
    points.length === 0
      ? LADDER_SINGLE[0]!
      : nextRung(LADDER_SINGLE, points[points.length - 1]!.massKg);
  const ladderExhausted =
    points.length > 0 &&
    points[points.length - 1]!.massKg >= LADDER_SINGLE[LADDER_SINGLE.length - 1]!;

  const result = useMemo(
    () =>
      step === 'result' && restLengthCm !== null ? fitCalibration(restLengthCm, points) : null,
    [step, restLengthCm, points],
  );

  function confirmRest() {
    const value = parseDecimal(restInput);
    if (value === null || value < 20 || value > 300) {
      setError(w.invalidRest);
      return;
    }
    setError(null);
    setRestLengthCm(value);
    setStep('points');
  }

  function addPoint() {
    const value = parseDecimal(lengthInput);
    if (restLengthCm === null || value === null || value < restLengthCm) {
      setError(w.invalidLength);
      return;
    }
    setError(null);
    setPoints([...points, { massKg: nextMass, lengthCm: value }]);
    setLengthInput('');
  }

  async function handleSave() {
    if (!result || saving) return;
    setSaving(true);
    await saveCalibration(band.id, result.calibration);
    router.back();
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-3 p-4 pb-10"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: w.title(band.label) }} />

      {step === 'rest' ? (
        <Card>
          <CardTitle>{w.stepRest}</CardTitle>
          <CardDescription>{w.restHint}</CardDescription>
          <CardContent className="mt-3">
            <NumberField label={w.restLabel} value={restInput} onChangeText={setRestInput} />
            {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
            <Button label={w.next} onPress={confirmRest} />
          </CardContent>
        </Card>
      ) : null}

      {step === 'points' ? (
        <>
          <Card>
            <CardTitle>{w.stepPoints}</CardTitle>
            <CardDescription>{w.pointsHint}</CardDescription>
            <CardContent className="mt-3">
              {points.map((p) => (
                <View key={p.massKg} className="flex-row justify-between">
                  <Text variant="muted">{p.massKg} kg</Text>
                  <Text className="tabular-nums">{formatDecimal(p.lengthCm)} cm</Text>
                </View>
              ))}
              {points.length > 0 ? (
                <Text variant="muted" className="text-xs">
                  {w.pointsSoFar(points.length)}
                </Text>
              ) : null}
              {stretchHasPlateaued(points) ? (
                <Text className="text-sm text-destructive">{w.plateau}</Text>
              ) : null}
              {!ladderExhausted ? (
                <View className="flex-row items-end gap-2">
                  <NumberField
                    label={w.lengthFor(nextMass)}
                    value={lengthInput}
                    onChangeText={setLengthInput}
                    className="flex-1"
                  />
                  <Button label={w.addPoint} onPress={addPoint} />
                </View>
              ) : null}
              {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
            </CardContent>
          </Card>
          <View className="flex-row gap-2">
            <Button
              label={w.removeLast}
              variant="outline"
              onPress={() => setPoints(points.slice(0, -1))}
              disabled={points.length === 0}
              className="flex-1"
            />
            <Button label={w.finish} onPress={() => setStep('result')} className="flex-1" />
          </View>
        </>
      ) : null}

      {step === 'result' && result ? (
        <>
          <Card>
            <CardTitle>{w.stepResult}</CardTitle>
            <CardContent className="mt-2">
              <Text>{w.reason[result.reason]}</Text>
              {result.r2 !== null ? <Text variant="muted">{w.r2(result.r2)}</Text> : null}
              {result.calibration.fit && result.calibration.maxMeasuredKg !== null ? (
                <Text variant="muted">{w.maxMeasured(result.calibration.maxMeasuredKg)}</Text>
              ) : null}
            </CardContent>
          </Card>

          {result.calibration.fit ? (
            <Card>
              <CardTitle>{w.preview}</CardTitle>
              <CardContent className="mt-2">
                {POSITIONS.map((p) => (
                  <Text key={p} variant="muted">
                    {w.previewRow(
                      p,
                      pl.bands.estimate(estimateBandLoad(result.calibration, p, PREVIEW_ROM_CM)),
                    )}
                  </Text>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <View className="flex-row gap-2">
            <Button
              label={w.back}
              variant="outline"
              onPress={() => setStep('points')}
              className="flex-1"
            />
            <Button label={w.save} onPress={handleSave} disabled={saving} className="flex-1" />
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
