import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { syncReminders } from '@/lib/reminders';
import { pl } from '@/strings/pl';

import { db } from './client';
import migrations from './migrations/migrations';
import { abandonStaleWorkouts } from './repositories/workouts';
import { seedDatabase } from './seed';

/**
 * Applies pending migrations, seeds the bundled catalogue and sweeps any
 * workout left "in_progress" for more than 12 hours — before rendering
 * anything that touches the database. The local reminders are then
 * recomputed in the background: they depend on the same state, but the
 * first screen must not wait on the notification subsystem.
 * See SPEC §7.1 and IMPLEMENTACJA.md §10.2.
 */
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const { success, error } = useMigrations(db, migrations);
  const [seeded, setSeeded] = useState(false);
  const [seedError, setSeedError] = useState<Error | null>(null);

  useEffect(() => {
    if (!success) return;
    let cancelled = false;

    seedDatabase()
      .then(() => abandonStaleWorkouts())
      .then(() => {
        if (!cancelled) setSeeded(true);
        // Recomputed from state, so a missed day or a changed clock never
        // leaves a stale schedule behind. A failure here (OS quirk, no
        // permission) is logged and must never block the app.
        void syncReminders().catch((e: unknown) => {
          console.warn('reminder sync failed', e);
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setSeedError(e instanceof Error ? e : new Error(String(e)));
      });

    return () => {
      cancelled = true;
    };
  }, [success]);

  const failure = error ?? seedError;

  if (failure) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-background p-6">
        <Text variant="heading">{pl.common.error}</Text>
        <Text variant="muted" className="text-center">
          {failure.message}
        </Text>
      </View>
    );
  }

  if (!success || !seeded) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-background">
        <ActivityIndicator />
        <Text variant="muted">{pl.common.loading}</Text>
      </View>
    );
  }

  return <>{children}</>;
}
