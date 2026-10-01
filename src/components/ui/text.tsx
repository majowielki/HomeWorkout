import { cva, type VariantProps } from 'class-variance-authority';
import { Text as RNText } from 'react-native';

import { cn } from '@/lib/cn';

/*
 * Display variants use the Space Grotesk families from tailwind.config.js
 * and deliberately carry no `font-bold` — see the note there.
 */
const textVariants = cva('text-foreground', {
  variants: {
    variant: {
      default: 'text-base',
      /** Screen-level headline (tab pages, hero cards). */
      display: 'font-display text-4xl leading-[44px] tracking-[-1px]',
      title: 'font-display text-2xl tracking-[-0.5px]',
      heading: 'font-display-semibold text-lg tracking-[-0.2px]',
      muted: 'text-sm text-muted-foreground',
      /** Small all-caps label above a title or a value. */
      eyebrow: 'font-display-medium text-xs uppercase tracking-[1.4px] text-muted-foreground',
      /** Large numerals — reps, weight, timer. Tabular so digits do not jitter. */
      metric: 'font-display text-4xl tabular-nums tracking-[-1px]',
    },
  },
  defaultVariants: { variant: 'default' },
});

type TextProps = React.ComponentProps<typeof RNText> & VariantProps<typeof textVariants>;

export function Text({ className, variant, ...props }: TextProps) {
  return <RNText className={cn(textVariants({ variant }), className)} {...props} />;
}

export { textVariants };
