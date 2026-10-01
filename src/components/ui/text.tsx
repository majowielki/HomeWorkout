import { cva, type VariantProps } from 'class-variance-authority';
import { Text as RNText } from 'react-native';

import { cn } from '@/lib/cn';

const textVariants = cva('text-foreground', {
  variants: {
    variant: {
      default: 'text-base',
      title: 'text-2xl font-bold',
      heading: 'text-lg font-semibold',
      muted: 'text-sm text-muted-foreground',
      /** Large numerals — reps, weight, timer. Tabular so digits do not jitter. */
      metric: 'text-4xl font-bold tabular-nums',
    },
  },
  defaultVariants: { variant: 'default' },
});

type TextProps = React.ComponentProps<typeof RNText> & VariantProps<typeof textVariants>;

export function Text({ className, variant, ...props }: TextProps) {
  return <RNText className={cn(textVariants({ variant }), className)} {...props} />;
}
