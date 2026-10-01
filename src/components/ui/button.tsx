import { cva, type VariantProps } from 'class-variance-authority';
import { Pressable, Text } from 'react-native';

import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'flex-row items-center justify-center gap-2 rounded-xl active:opacity-80',
  {
    variants: {
      variant: {
        default: 'bg-primary',
        secondary: 'bg-secondary',
        destructive: 'bg-destructive',
        outline: 'border border-border bg-transparent',
        ghost: 'bg-transparent',
      },
      size: {
        default: 'h-12 px-5',
        sm: 'h-9 px-3',
        /** Thumb-sized target for logging sets mid-workout. */
        lg: 'h-16 px-6',
        icon: 'h-12 w-12 px-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

const labelVariants = cva('font-semibold', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      destructive: 'text-destructive-foreground',
      outline: 'text-foreground',
      ghost: 'text-foreground',
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
  };

export function Button({
  className,
  labelClassName,
  variant,
  size,
  label,
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
        <Text className={cn(labelVariants({ variant, size }), labelClassName)}>{label}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

export { buttonVariants };
