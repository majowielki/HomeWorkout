import { eq } from 'drizzle-orm';

import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from '@/domain/reminders/schedule';
import { DEFAULT_DAY_BOUNDARY_HOUR } from '@/domain/time/trainingDate';
import type { KneeProfile, MedicalProfile } from '@/domain/types';

import { db, type Executor } from '../client';
import { userProfile } from '../schema';

/** Single-user app: the one and only profile row. */
export const PROFILE_ID = 1;

/**
 * Profile row seeded on first launch. The knee condition is this user's
 * documented state; physioApproved starts false so the engine runs in
 * conservative (bilateral-only) mode until a physiotherapist has reviewed
 * the exercise list. See Documents/PLAN.md §1.4.
 */
/** The documented condition the app was made for; also what switching the knee profile on again starts from. */
export const DOCUMENTED_KNEE_PROFILE: KneeProfile = {
  side: 'right',
  missingCollaterals: true,
  aclReconstructed: true,
  varusThrust: true,
  physioApproved: false,
};

export function ensureProfile(now: string, executor: Executor = db): void {
  const existing = executor
    .select({ id: userProfile.id })
    .from(userProfile)
    .where(eq(userProfile.id, PROFILE_ID))
    .get();
  if (existing) return;

  executor
    .insert(userProfile)
    .values({
      id: PROFILE_ID,
      dayBoundaryHour: DEFAULT_DAY_BOUNDARY_HOUR,
      kneeProfile: DOCUMENTED_KNEE_PROFILE,
      updatedAt: now,
    })
    .run();
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
  return row?.dayBoundaryHour ?? DEFAULT_DAY_BOUNDARY_HOUR;
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
    | 'restWeekdays'
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

/** Query for `useLiveQuery`: the knee profile alone, so screens re-render when it changes. */
export function liveKneeProfileQuery() {
  return db
    .select({ kneeProfile: userProfile.kneeProfile })
    .from(userProfile)
    .where(eq(userProfile.id, PROFILE_ID));
}

/** Exercises the person asked never to be offered again (SPEC §10.2). */
export async function getExcludedExerciseIds(): Promise<string[]> {
  const [row] = await db
    .select({ ids: userProfile.excludedExerciseIds })
    .from(userProfile)
    .where(eq(userProfile.id, PROFILE_ID))
    .limit(1);
  return row?.ids ?? [];
}

/** Adds (`excluded: true`) or removes an exercise from the do-not-suggest list. */
export async function setExerciseExcluded(
  exerciseId: string,
  excluded: boolean,
  now: Date = new Date(),
): Promise<void> {
  const current = new Set(await getExcludedExerciseIds());
  if (excluded) current.add(exerciseId);
  else current.delete(exerciseId);
  await db
    .update(userProfile)
    .set({ excludedExerciseIds: [...current], updatedAt: now.toISOString() })
    .where(eq(userProfile.id, PROFILE_ID));
}
