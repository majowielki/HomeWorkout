import { eq } from 'drizzle-orm';

import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from '@/domain/reminders/schedule';
import type { MedicalProfile } from '@/domain/types';

import { db, type Database } from '../client';
import { userProfile } from '../schema';

/** Single-user app: the one and only profile row. */
export const PROFILE_ID = 1;

/** Either the db itself or a transaction handle — both expose the same query API. */
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Profile row seeded on first launch. The knee condition is this user's
 * documented state; physioApproved starts false so the engine runs in
 * conservative (bilateral-only) mode until a physiotherapist has reviewed
 * the exercise list. See Documents/PLAN.md §1.4.
 */
export async function ensureProfile(now: string, executor: Executor = db): Promise<void> {
  const [existing] = await executor
    .select({ id: userProfile.id })
    .from(userProfile)
    .where(eq(userProfile.id, PROFILE_ID))
    .limit(1);
  if (existing) return;

  await executor.insert(userProfile).values({
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

export type ProfileRow = typeof userProfile.$inferSelect;

export async function getProfile(): Promise<ProfileRow | null> {
  const [row] = await db.select().from(userProfile).where(eq(userProfile.id, PROFILE_ID)).limit(1);
  return row ?? null;
}

export type ProfileUpdate = Partial<
  Pick<
    ProfileRow,
    | 'heightCm'
    | 'birthYear'
    | 'sex'
    | 'dayBoundaryHour'
    | 'saddleHeightCm'
    | 'kneeProfile'
    | 'reminders'
  >
>;

export async function updateProfile(patch: ProfileUpdate): Promise<void> {
  await db
    .update(userProfile)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(userProfile.id, PROFILE_ID));
}

/** Stored settings merged over the defaults, so a newly added field never comes back undefined. */
export async function getReminderSettings(): Promise<ReminderSettings> {
  const row = await getProfile();
  return {
    ...DEFAULT_REMINDER_SETTINGS,
    ...row?.reminders,
    weight: { ...DEFAULT_REMINDER_SETTINGS.weight, ...row?.reminders?.weight },
    workout: { ...DEFAULT_REMINDER_SETTINGS.workout, ...row?.reminders?.workout },
  };
}
