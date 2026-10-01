import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

type Props = {
  title: string;
  /** Small all-caps line above the title — a date, a count, a status. */
  eyebrow?: string;
  /** One line of context under the title. */
  subtitle?: string;
  /** Right-aligned slot level with the title, e.g. an info button. */
  right?: React.ReactNode;
  className?: string;
};

/**
 * Large in-content title for the tab screens, which hide the navigator
 * header. Pads itself below the status bar, so it must be the first child
 * of the screen's scroll content.
 */
export function PageHeader({ title, eyebrow, subtitle, right, className }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View className={cn('gap-1 pb-2', className)} style={{ paddingTop: insets.top + 20 }}>
      {eyebrow ? <Text variant="eyebrow">{eyebrow}</Text> : null}
      <View className="flex-row items-end justify-between gap-3">
        <Text variant="display" className="flex-1">
          {title}
        </Text>
        {right}
      </View>
      {subtitle ? <Text variant="muted">{subtitle}</Text> : null}
    </View>
  );
}

/**
 * Opaque strip behind the status bar for screens without a navigator
 * header — otherwise scrolled content slides under the clock. Render it
 * after the scroll view so it paints on top.
 */
export function StatusBarScrim() {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      className="absolute left-0 right-0 top-0 bg-background/95"
      style={{ height: insets.top }}
    />
  );
}
