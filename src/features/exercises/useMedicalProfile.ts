import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';

import { liveKneeProfileQuery } from '@/db/repositories/profile';
import type { MedicalProfile } from '@/domain/types';

/** Live medical profile; re-renders when the knee settings change. */
export function useMedicalProfile(): MedicalProfile {
  const { data } = useLiveQuery(liveKneeProfileQuery());
  return useMemo(() => ({ knee: data?.[0]?.kneeProfile ?? null }), [data]);
}
