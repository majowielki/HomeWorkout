import { Pressable } from 'react-native';

import { cn } from '@/lib/cn';

import { Text } from './text';

type ChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  className?: string;
};

/** Single-choice pill button — used for RIR, band colour and anchor position. */
export function Chip({ label, selected, onPress, className }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={cn(
        'items-center justify-center rounded-full border px-3.5 py-2',
        selected ? 'border-primary bg-primary' : 'border-border bg-transparent',
        className,
      )}
    >
      <Text
        className={cn(
          'text-sm font-medium',
          selected ? 'text-primary-foreground' : 'text-foreground',
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
