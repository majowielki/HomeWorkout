import { cva, type VariantProps } from 'class-variance-authority';
import { Pressable, Text } from 'react-native';

import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'flex-row items-center justify-center gap-2 rounded-full active:scale-[0.98] active:opacity-85',
  {
    variants: {
      variant: {
        default: 'bg-primary',
        secondary: 'bg-secondary',
        destructive: 'bg-destructive',
        outline: 'border border-border bg-transparent',
        ghost: 'bg-transparent',
        /** High-contrast ink button — the strongest action on a plain surface. */
        inverse: 'bg-foreground',
      },
      size: {
        default: 'h-12 px-6',
        sm: 'h-9 px-4',
        /** Thumb-sized target for logging sets mid-workout. */
        lg: 'h-16 px-8',
        icon: 'h-12 w-12 px-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

const labelVariants = cva('font-display-semibold tracking-[-0.2px]', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      destructive: 'text-destructive-foreground',
      outline: 'text-foreground',
      ghost: 'text-foreground',
      inverse: 'text-background',
    },
    size: {
      default: 'text-base',
      sm: 'text-sm',
      lg: 'text-lg',
      icon: 'text-base',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

type ButtonProps = React.ComponentProps<typeof Pressable> &
  VariantProps<typeof buttonVariants> & {
    label?: string;
    labelClassName?: string;
    /** Rendered before the label, e.g. `<Play size={18} className="text-primary-foreground" />`. */
    icon?: React.ReactNode;
  };

export function Button({
  className,
  labelClassName,
  variant,
  size,
  label,
  icon,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      className={cn(buttonVariants({ variant, size }), disabled && 'opacity-50', className)}
      {...props}
    >
      {label ? (
        <>
          {icon}
          <Text className={cn(labelVariants({ variant, size }), labelClassName)}>{label}</Text>
        </>
      ) : (
        children
      )}
    </Pressable>
  );
}

export { buttonVariants, labelVariants };
