import { eq } from 'drizzle-orm';

import type { MedicalProfile } from '@/domain/types';

import { db } from '../client';
import { userProfile } from '../schema';

const PROFILE_ID = 1;

/**
 * Profile row seeded on first launch. The knee condition is this user's
 * documented state; physioApproved starts false so the engine runs in
 * conservative (bilateral-only) mode until a physiotherapist has reviewed
 * the exercise list. See Documents/PLAN.md §1.4.
 */
export async function ensureProfile(now: string): Promise<void> {
  const [existing] = await db
    .select({ id: userProfile.id })
    .from(userProfile)
    .where(eq(userProfile.id, PROFILE_ID))
    .limit(1);
  if (existing) return;

  await db.insert(userProfile).values({
    id: PROFILE_ID,
    dayBoundaryHour: 4,
    kneeProfile: {
      side: 'right',
      missingCollaterals: true,
      aclReconstructed: true,
      varusThrust: true,
      physioApproved: false,
    },
    updatedAt: now,
  });
}

export async function getMedicalProfile(): Promise<MedicalProfile> {
  const [row] = await db
    .select({ kneeProfile: userProfile.kneeProfile })
    .from(userProfile)
    .where(eq(userProfile.id, PROFILE_ID))
    .limit(1);
  return { knee: row?.kneeProfile ?? null };
}

export async function getDayBoundaryHour(): Promise<number> {
  const [row] = await db
    .select({ dayBoundaryHour: userProfile.dayBoundaryHour })
    .from(userProfile)
    .where(eq(userProfile.id, PROFILE_ID))
    .limit(1);
  return row?.dayBoundaryHour ?? 4;
}
