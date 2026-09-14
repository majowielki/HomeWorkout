import { TextInput } from 'react-native';

import { cn } from '@/lib/cn';

type InputProps = React.ComponentProps<typeof TextInput>;

/**
 * `placeholder:` is NativeWind's variant that routes `color` into
 * `placeholderTextColor` — the only way to theme the placeholder without a
 * hardcoded value.
 */
export function Input({ className, ...props }: InputProps) {
  return (
    <TextInput
      className={cn(
        'h-12 rounded-xl border border-input bg-background px-4 text-base text-foreground placeholder:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
