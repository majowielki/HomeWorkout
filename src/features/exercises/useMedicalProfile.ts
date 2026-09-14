import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';
import { useMemo } from 'react';

import { db } from '@/db/client';
import { PROFILE_ID } from '@/db/repositories/profile';
import { userProfile } from '@/db/schema';
import type { MedicalProfile } from '@/domain/types';

/** Live medical profile; re-renders when the knee settings change. */
export function useMedicalProfile(): MedicalProfile {
  const { data } = useLiveQuery(
    db
      .select({ kneeProfile: userProfile.kneeProfile })
      .from(userProfile)
      .where(eq(userProfile.id, PROFILE_ID)),
  );
  return useMemo(() => ({ knee: data?.[0]?.kneeProfile ?? null }), [data]);
}
