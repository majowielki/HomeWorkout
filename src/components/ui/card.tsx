import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

type ViewProps = React.ComponentProps<typeof View>;

export function Card({ className, ...props }: ViewProps) {
  return (
    <View className={cn('rounded-2xl border border-border bg-card p-4', className)} {...props} />
  );
}

export function CardHeader({ className, ...props }: ViewProps) {
  return <View className={cn('mb-3 gap-1', className)} {...props} />;
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
