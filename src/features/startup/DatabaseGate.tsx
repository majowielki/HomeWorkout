import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useDatabaseStartup } from '@/db/startup';
import { syncReminders } from '@/lib/reminders';
import { pl } from '@/strings/pl';

/**
 * Renders nothing that touches the database until it is migrated and seeded.
 * The local reminders are then recomputed in the background: they depend on
 * the same state, but the first screen must not wait on the notification
 * subsystem, and a failure there (OS quirk, no permission) never blocks the app.
 */
export function DatabaseGate({ children }: { children: React.ReactNode }) {
  const startup = useDatabaseStartup();

  useEffect(() => {
    if (startup.status !== 'ready') return;
    // Recomputed from state, so a missed day or a changed clock never leaves a stale schedule.
    void syncReminders().catch((e: unknown) => {
      console.warn('reminder sync failed', e);
    });
  }, [startup.status]);

  if (startup.status === 'failed') {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-background p-6">
        <Text variant="heading">{pl.common.error}</Text>
        <Text variant="muted" className="text-center">
          {startup.error.message}
        </Text>
      </View>
    );
  }

  if (startup.status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-background">
        <ActivityIndicator />
        <Text variant="muted">{pl.common.loading}</Text>
      </View>
    );
  }

  return <>{children}</>;
}
