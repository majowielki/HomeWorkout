import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { useEffect, useState } from 'react';

import { db } from './client';
import migrations from './migrations/migrations';
import { abandonStaleWorkouts } from './repositories/workouts';
import { seedDatabase } from './seed';

export type DatabaseStartup =
  { status: 'loading' } | { status: 'ready' } | { status: 'failed'; error: Error };

/**
 * Applies pending migrations, seeds the bundled catalogue and sweeps any
 * workout left "in_progress" past SESSION_CONFIG.staleAfterHours — before
 * anything reads the database. See SPEC §7.1 and IMPLEMENTACJA.md §10.2.
 * The screen around it (loading, error) is the app's, not the data layer's.
 */
export function useDatabaseStartup(): DatabaseStartup {
  const { success, error } = useMigrations(db, migrations);
  const [state, setState] = useState<DatabaseStartup>({ status: 'loading' });

  useEffect(() => {
    if (!success) return;
    let cancelled = false;
    seedDatabase()
      .then(() => abandonStaleWorkouts())
      .then(() => {
        if (!cancelled) setState({ status: 'ready' });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState({ status: 'failed', error: e instanceof Error ? e : new Error(String(e)) });
      });
    return () => {
      cancelled = true;
    };
  }, [success]);

  return error ? { status: 'failed', error } : state;
}
