import { useMemo } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';

import { Text } from '@/components/ui/text';
import type { SmoothedPoint } from '@/domain/metrics/series';
import { useThemeColors } from '@/lib/theme';

type Props = {
  points: SmoothedPoint[];
  /** Draw the smoothed line on top of the raw dots. */
  showAverage?: boolean;
  unit: string;
  /** Rendered when there are fewer than `minPoints` entries. */
  emptyText: string;
  minPoints?: number;
};

const LABEL_EVERY = 10;

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

/**
 * Raw entries as dots, trailing average as a line. Both series share the
 * same x positions (one per entry), which is why the average is computed
 * per entry rather than per calendar day — a gap in weigh-ins is a gap on
 * the x axis, not an interpolated segment.
 */
export function TrendChart({ points, showAverage = true, unit, emptyText, minPoints = 3 }: Props) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();

  const { raw, smoothed, yOffset, yMax } = useMemo(() => {
    const values = points.map((p) => p.value);
    const averages = points.map((p) => p.average).filter((a): a is number => a !== null);
    const all = [...values, ...averages];
    const min = all.length ? Math.min(...all) : 0;
    const max = all.length ? Math.max(...all) : 1;
    const pad = Math.max(0.5, (max - min) * 0.15);
    const yOffset = Math.floor((min - pad) * 2) / 2;
    const yMax = Math.ceil((max + pad) * 2) / 2 - yOffset;

    const raw = points.map((p, i) => ({
      value: p.value,
      label: i % LABEL_EVERY === 0 || i === points.length - 1 ? shortDate(p.date) : undefined,
    }));
    const smoothed = points.map((p) => ({ value: p.average ?? p.value }));
    return { raw, smoothed, yOffset, yMax };
  }, [points]);

  if (points.length < minPoints) {
    return (
      <View className="items-center justify-center py-8">
        <Text variant="muted">{emptyText}</Text>
      </View>
    );
  }

  return (
    <View className="-ml-2">
      <LineChart
        data={raw}
        data2={showAverage ? smoothed : undefined}
        width={width - 64}
        height={200}
        adjustToWidth
        yAxisOffset={yOffset}
        maxValue={yMax}
        noOfSections={4}
        yAxisLabelSuffix={` ${unit}`}
        yAxisTextStyle={{ color: colors.mutedForeground, fontSize: 10 }}
        xAxisLabelTextStyle={{ color: colors.mutedForeground, fontSize: 10 }}
        yAxisColor={colors.border}
        xAxisColor={colors.border}
        rulesColor={colors.border}
        rulesType="solid"
        // series 1: raw entries — dots only
        color1="transparent"
        thickness1={0}
        dataPointsColor1={colors.mutedForeground}
        dataPointsRadius={3}
        // series 2: trailing average — line only
        color2={colors.primary}
        thickness2={2}
        hideDataPoints2
        curved
        isAnimated={false}
        disableScroll
      />
    </View>
  );
}
