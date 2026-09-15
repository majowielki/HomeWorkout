import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';

import { liveBandsQuery } from '@/db/repositories/bands';
import type { BandCalibrationMap } from '@/domain/types';

/** Every band's calibration keyed by id, live — a wizard save shows up in an open session. */
export function useBandCalibrations(): BandCalibrationMap {
  const { data } = useLiveQuery(liveBandsQuery());
  return useMemo(() => {
    const map: BandCalibrationMap = {};
    for (const row of data ?? []) map[row.id] = row.calibration;
    return map;
  }, [data]);
}
