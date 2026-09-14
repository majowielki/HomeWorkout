import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';

import { db } from '@/db/client';
import { exercises } from '@/db/schema';
import type { Exercise } from '@/domain/types';

/** All exercises keyed by id — cheap at ~60 rows, avoids one query per step. */
export function useExerciseMap(): Record<string, Exercise> {
  const { data } = useLiveQuery(db.select().from(exercises));
  return useMemo(() => {
    const map: Record<string, Exercise> = {};
    for (const row of data ?? []) map[row.id] = row.data;
    return map;
  }, [data]);
}
