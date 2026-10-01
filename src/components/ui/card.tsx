import { cva, type VariantProps } from 'class-variance-authority';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

type ViewProps = React.ComponentProps<typeof View>;

const cardVariants = cva('overflow-hidden rounded-3xl p-5', {
  variants: {
    variant: {
      default: 'border border-border bg-card',
      /** Flat tinted surface for secondary information inside a screen. */
      muted: 'bg-secondary',
      /** Ink hero surface, dark in both themes — one per screen at most. */
      inverse: 'bg-inverse',
      /** Accent-filled card for a single standout state (e.g. a session in progress). */
      accent: 'bg-primary',
    },
  },
  defaultVariants: { variant: 'default' },
});

type CardProps = ViewProps & VariantProps<typeof cardVariants>;

export function Card({ className, variant, ...props }: CardProps) {
  return <View className={cn(cardVariants({ variant }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: ViewProps) {
  return <View className={cn('mb-3 gap-1', className)} {...props} />;
}

export function CardEyebrow({ className, ...props }: React.ComponentProps<typeof Text>) {
  return <Text variant="eyebrow" className={cn('mb-1', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<typeof Text>) {
  return <Text variant="heading" className={cn('text-card-foreground', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<typeof Text>) {
  return <Text variant="muted" className={className} {...props} />;
}

export function CardContent({ className, ...props }: ViewProps) {
  return <View className={cn('gap-2', className)} {...props} />;
}

export { cardVariants };
