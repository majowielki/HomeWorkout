import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { pl } from '@/strings/pl';

import { db } from './client';
import migrations from './migrations/migrations';
import { seedDatabase } from './seed';

/**
 * Applies pending migrations, then seeds the bundled catalogue, before
 * rendering anything that touches the database.
 */
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const { success, error } = useMigrations(db, migrations);
  const [seeded, setSeeded] = useState(false);
  const [seedError, setSeedError] = useState<Error | null>(null);

  useEffect(() => {
    if (!success) return;
    let cancelled = false;

    seedDatabase()
      .then(() => {
        if (!cancelled) setSeeded(true);
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
