import { Pressable, View } from 'react-native';

import { Minus, Plus } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

type StepperProps = {
  label: string;
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementDisabled?: boolean;
  incrementDisabled?: boolean;
  className?: string;
};

/**
 * Large -/value/+ control for the active-session screen. Thumb-sized
 * targets (44px) because this gets used with sweaty fingers mid-set,
 * not browsed at leisure. See Documents/IMPLEMENTACJA.md §2.3.
 */
export function Stepper({
  label,
  value,
  onDecrement,
  onIncrement,
  decrementDisabled,
  incrementDisabled,
  className,
}: StepperProps) {
  return (
    <View className={cn('gap-1.5', className)}>
      <Text variant="muted" className="text-center text-xs uppercase tracking-wide">
        {label}
      </Text>
      <View className="flex-row items-center justify-center gap-2">
        <Pressable
          onPress={onDecrement}
          disabled={decrementDisabled}
          accessibilityRole="button"
          accessibilityLabel={`Zmniejsz: ${label}`}
          className={cn(
            'h-11 w-11 items-center justify-center rounded-xl bg-secondary active:opacity-70',
            decrementDisabled && 'opacity-30',
          )}
        >
          <Minus size={20} className="text-secondary-foreground" />
        </Pressable>
        <Text variant="metric" className="min-w-[84px] text-center text-3xl">
          {value}
        </Text>
        <Pressable
          onPress={onIncrement}
          disabled={incrementDisabled}
          accessibilityRole="button"
          accessibilityLabel={`Zwiększ: ${label}`}
          className={cn(
            'h-11 w-11 items-center justify-center rounded-xl bg-secondary active:opacity-70',
            incrementDisabled && 'opacity-30',
          )}
        >
          <Plus size={20} className="text-secondary-foreground" />
        </Pressable>
      </View>
    </View>
  );
}
