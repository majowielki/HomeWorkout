import { TextInput } from 'react-native';

import { cn } from '@/lib/cn';

type InputProps = React.ComponentProps<typeof TextInput>;

export function Input({ className, ...props }: InputProps) {
  return (
    <TextInput
      placeholderClassName="text-muted-foreground"
      className={cn(
        'h-12 rounded-xl border border-input bg-background px-4 text-base text-foreground',
        className,
      )}
      {...props}
    />
  );
}
