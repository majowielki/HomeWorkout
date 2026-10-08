import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

type ChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  className?: string;
  /** Colour dot before the label — e.g. the physical colour of a band. */
  swatch?: string;
  /** A smaller second line under the label — e.g. the RIR behind a felt effort. */
  caption?: string;
};

/** Single-choice pill button — used for the felt effort, band colour and anchor position. */
export function Chip({ label, selected, onPress, className, swatch, caption }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={cn(
        'min-h-10 flex-row items-center justify-center gap-2 rounded-full border px-4 py-2 active:opacity-80',
        selected ? 'border-primary bg-primary' : 'border-transparent bg-secondary',
        className,
      )}
    >
      {swatch ? (
        <View
          className="h-3 w-3 rounded-full border border-foreground/20"
          style={{ backgroundColor: swatch }}
        />
      ) : null}
      <View className="items-center">
        <Text
          className={cn(
            'font-display-medium text-sm',
            selected ? 'text-primary-foreground' : 'text-secondary-foreground',
          )}
        >
          {label}
        </Text>
        {caption ? (
          <Text
            className={cn(
              'text-xs',
              selected ? 'text-primary-foreground/80' : 'text-muted-foreground',
            )}
          >
            {caption}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
