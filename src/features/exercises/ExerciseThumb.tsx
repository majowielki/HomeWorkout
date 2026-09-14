import { Image } from 'expo-image';
import { View } from 'react-native';

import { exerciseMedia } from '@/assets/exercise-media';
import { Dumbbell } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

type Props = {
  mediaKey: string | null;
  /** 0 = start position, 1 = end position. */
  frame?: 0 | 1;
  className?: string;
};

/**
 * Square thumbnail with a neutral placeholder when no frame exists.
 * `className` on expo-image only works because src/lib/interop.ts registers
 * it with NativeWind — without that the image ignores it and renders at its
 * intrinsic 850px width.
 */
export function ExerciseThumb({ mediaKey, frame = 1, className }: Props) {
  const source = mediaKey ? exerciseMedia[mediaKey]?.[frame] : undefined;

  if (!source) {
    return (
      <View
        className={cn('items-center justify-center rounded-xl bg-muted', className)}
        accessibilityLabel="Brak zdjęcia"
      >
        <Dumbbell size={22} className="text-muted-foreground" />
      </View>
    );
  }

  return (
    <Image
      source={source}
      contentFit="cover"
      transition={100}
      className={cn('rounded-xl bg-muted', className)}
    />
  );
}
