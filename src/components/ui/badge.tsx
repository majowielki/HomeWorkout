import { cva, type VariantProps } from 'class-variance-authority';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

const badgeVariants = cva('flex-row items-center gap-1 self-start rounded-full px-2.5 py-1', {
  variants: {
    variant: {
      default: 'bg-secondary',
      accent: 'bg-primary',
      outline: 'border border-border',
      /** For use on the inverse hero surface. */
      onInverse: 'bg-inverse-foreground/10',
    },
  },
  defaultVariants: { variant: 'default' },
});

const labelVariants = cva('font-display-medium text-xs', {
  variants: {
    variant: {
      default: 'text-secondary-foreground',
      accent: 'text-primary-foreground',
      outline: 'text-muted-foreground',
      onInverse: 'text-inverse-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

type Props = VariantProps<typeof badgeVariants> & {
  label: string;
  icon?: React.ReactNode;
  className?: string;
};

/** Small status pill: "Sugerowane", "w trakcie", a trend value. */
export function Badge({ label, icon, variant, className }: Props) {
  return (
    <View className={cn(badgeVariants({ variant }), className)}>
      {icon}
      <Text className={labelVariants({ variant })}>{label}</Text>
    </View>
  );
}
