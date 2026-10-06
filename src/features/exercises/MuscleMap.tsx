import { Image } from 'expo-image';
import { View } from 'react-native';

import { ymoveMedia } from '@/assets/ymove-media';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';
import { pl } from '@/strings/pl';

/** The two shades the SVG paints worked muscles in. */
const PRIMARY = '#6D2BE8';
const SECONDARY = 'rgba(109,43,232,0.38)';

/** The drawing's viewBox (72 x 93); the image needs the ratio to size itself. */
const ASPECT = 72 / 93;

type Props = {
  exerciseId: string;
  name: string;
  className?: string;
};

/**
 * Front and back silhouettes with the muscles of the exercise shaded, as on
 * the YMove site. Always on a white card: the drawing's greys are made for a
 * light page and disappear on the dark theme. Renders nothing without a clip.
 */
export function MuscleMap({ exerciseId, name, className }: Props) {
  const entry = ymoveMedia[exerciseId];
  if (!entry) return null;

  const l = pl.exercises.bodyMapLegend;
  const s = pl.exercises.sections;

  return (
    <View className={cn('items-center gap-3 rounded-2xl bg-white p-4', className)}>
      <Image
        source={entry.bodyMap}
        contentFit="contain"
        accessibilityLabel={pl.a11y.bodyMap(name)}
        style={{ width: '100%', maxWidth: 260, aspectRatio: ASPECT }}
      />
      <View className="w-full max-w-[260px] flex-row justify-around">
        <Text className="text-xs text-neutral-500">{s.bodyMapFront}</Text>
        <Text className="text-xs text-neutral-500">{s.bodyMapBack}</Text>
      </View>
      <View className="flex-row gap-5">
        <Legend color={PRIMARY} label={l.primary} />
        <Legend color={SECONDARY} label={l.secondary} />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
      <Text className="text-xs text-neutral-700">{label}</Text>
    </View>
  );
}
