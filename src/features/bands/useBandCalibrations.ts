import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';

import { db } from '@/db/client';
import { bands } from '@/db/schema';
import type { BandCalibration } from '@/domain/types';

export type CalibrationMap = Record<string, BandCalibration | null>;

/** Every band's calibration keyed by id, live — a wizard save shows up in an open session. */
export function useBandCalibrations(): CalibrationMap {
  const { data } = useLiveQuery(db.select().from(bands));
  return useMemo(() => {
    const map: CalibrationMap = {};
    for (const row of data ?? []) map[row.id] = row.calibration;
    return map;
  }, [data]);
}
