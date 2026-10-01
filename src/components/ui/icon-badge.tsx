import { cva, type VariantProps } from 'class-variance-authority';
import { View } from 'react-native';

import type { LucideIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

const badgeVariants = cva('items-center justify-center rounded-2xl', {
  variants: {
    tone: {
      default: 'bg-secondary',
      accent: 'bg-primary',
      /** Translucent accent — for an icon on a dark (inverse) surface. */
      glow: 'bg-primary/15',
      inverse: 'bg-foreground',
    },
    size: {
      default: 'h-11 w-11',
      sm: 'h-9 w-9 rounded-xl',
      lg: 'h-16 w-16 rounded-3xl',
    },
  },
  defaultVariants: { tone: 'default', size: 'default' },
});

const iconColour = {
  default: 'text-foreground',
  accent: 'text-primary-foreground',
  glow: 'text-primary',
  inverse: 'text-background',
} as const;

const iconSize = { default: 20, sm: 16, lg: 28 } as const;

type Props = VariantProps<typeof badgeVariants> & {
  icon: LucideIcon;
  className?: string;
};

/** Rounded tile holding one icon — the leading visual of list rows and empty states. */
export function IconBadge({ icon: Icon, tone, size, className }: Props) {
  return (
    <View className={cn(badgeVariants({ tone, size }), className)}>
      <Icon size={iconSize[size ?? 'default']} className={iconColour[tone ?? 'default']} />
    </View>
  );
}
