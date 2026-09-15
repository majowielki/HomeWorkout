import { Link, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ChevronRight } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { type BandRow, listBands } from '@/db/repositories/bands';
import { BAND_CONFIG } from '@/domain/config/training';
import { needsRecalibration } from '@/domain/progression/calibration';
import { formatDate } from '@/lib/format';
import { pl } from '@/strings/pl';

function statusLine(band: BandRow): string {
  const c = band.calibration;
  if (!c) return pl.bands.notCalibrated;
  if (!c.fit || c.maxMeasuredKg === null) return pl.bands.noFit;
  const date = band.calibratedAt ? formatDate(band.calibratedAt.slice(0, 10)) : '';
  return `${pl.bands.calibrated(c.maxMeasuredKg, date)} · ${
    c.fit.type === 'linear' ? pl.bands.fitLinear : pl.bands.fitQuadratic
  }`;
}

export default function BandsScreen() {
  const [rows, setRows] = useState<BandRow[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      void listBands().then(setRows);
    }, []),
  );

  if (!rows) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: pl.bands.title }} />
        <ActivityIndicator />
      </View>
    );
  }

  const now = new Date();

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-4 pb-10">
      <Stack.Screen options={{ title: pl.bands.title }} />
      <Text variant="muted">{pl.bands.intro}</Text>
      <Text variant="muted">{pl.bands.positionsHint(BAND_CONFIG.anchorStepCm)}</Text>

      {rows.map((band) => (
        <Link key={band.id} href={{ pathname: '/bands/[id]', params: { id: band.id } }} asChild>
          <Card className="flex-row items-center gap-3 active:opacity-70">
            <View className="flex-1 gap-0.5">
              <CardTitle>{band.label}</CardTitle>
              <CardDescription>
                {pl.bands.nominal(band.nominalMinKg, band.nominalMaxKg)}
              </CardDescription>
              <CardDescription>{statusLine(band)}</CardDescription>
              {band.calibratedAt ? (
                <CardDescription className="text-xs">
                  {pl.bands.cycles(band.cycleCount)}
                </CardDescription>
              ) : null}
              {needsRecalibration(band, now) ? (
                <Text className="text-sm text-destructive">{pl.bands.recalibrate}</Text>
              ) : null}
            </View>
            <ChevronRight size={18} className="text-muted-foreground" />
          </Card>
        </Link>
      ))}
    </ScrollView>
  );
}
