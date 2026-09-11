import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';

/**
 * enableChangeListener is what makes useLiveQuery re-render on writes.
 * WAL keeps reads from blocking while a set is being saved mid-workout.
 */
export const sqlite = openDatabaseSync('homeworkout.db', {
  enableChangeListener: true,
});

sqlite.execSync('PRAGMA journal_mode = WAL;');
sqlite.execSync('PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite, { schema });

export type Database = typeof db;
