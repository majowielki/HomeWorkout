import { Pressable, View } from 'react-native';

import { IconBadge } from '@/components/ui/icon-badge';
import { ChevronRight, type LucideIcon } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

type Props = Omit<React.ComponentProps<typeof Pressable>, 'children'> & {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  /** Replaces the chevron, e.g. a value or a button. */
  trailing?: React.ReactNode;
  /** Draws a hairline above the row — for rows stacked inside one grouped card. */
  divider?: boolean;
};

/**
 * Icon · title/subtitle · chevron. Works standalone or as an `asChild`
 * target of expo-router's `<Link>` (it forwards `onPress` and the rest).
 */
export function ListRow({ title, subtitle, icon, trailing, divider, className, ...props }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      className={cn('flex-row items-center gap-4 active:opacity-60', className)}
      {...props}
    >
      {icon ? <IconBadge icon={icon} className="my-3" /> : null}
      <View
        className={cn(
          'flex-1 flex-row items-center gap-3 self-stretch py-3.5',
          divider && 'border-t border-border',
        )}
      >
        <View className="flex-1 gap-0.5">
          <Text className="font-display-semibold text-base text-card-foreground">{title}</Text>
          {subtitle ? <Text variant="muted">{subtitle}</Text> : null}
        </View>
        {trailing ?? <ChevronRight size={18} className="text-muted-foreground" />}
      </View>
    </Pressable>
  );
}
