/**
 * How many sets an exposure gets (engine v2, 12 §5, D22).
 *
 * The engine recommends a number; it does not decide it. `allowed` is what fits
 * everything the engine counts — the muscles' room for the day and the week, the
 * time left — and what the person asks for inside it is taken without a
 * question. `advisable` is what the data can hold at all; between the two the
 * person may go with a warning that shows the numbers (D18).
 */

import { SETS_CONFIG } from '../config/training';
import type { TrainingPreferences } from '../preferences/preferences';
import type { MuscleGroup } from '../types';
import type { SlotKind } from './types';

export type SetsReason =
  | 'POLICY_DEFAULT'
  | 'USER_FIXED'
  | 'PHASE_DELOAD'
  | 'LIGHTER_DAY'
  | 'DAY_ROOM'
  | 'WEEK_ROOM'
  | 'TIME'
  | 'NO_ROOM';

export interface SetsRecommendation {
  /** 0 when `allowed` is null: there is no room for the exposure. */
  recommended: number;
  /** The numbers that fit everything counted; null when none does. */
  allowed: [number, number] | null;
  /** The numbers the data can hold; going beyond `allowed` within it needs the person’s say. */
  advisable: [number, number];
  reasons: SetsReason[];
}

export interface SetsRoom {
  /** Direct sets each muscle can still take today and this week; a muscle left out has no limit. */
  dayRoom: Partial<Record<MuscleGroup, number>>;
  weekRoom: Partial<Record<MuscleGroup, number>>;
  /** Whether an exposure of `n` sets fits the time left; left out, time is not a limit. */
  fitsTime?: (n: number) => boolean;
}

export interface SetsPolicy {
  byKind: Readonly<Record<SlotKind, number>>;
  deloadFactor: number;
  plannerMax: number;
  technicalMax: number;
}

export const DEFAULT_SETS_POLICY: SetsPolicy = SETS_CONFIG;

export interface SetsInput {
  kind: SlotKind;
  primaryMuscles: readonly MuscleGroup[];
  phase: 'work' | 'deload';
  /** The person asked for a lighter day: one set of everything. */
  lighterDay?: boolean;
  room: SetsRoom;
  policy?: SetsPolicy;
  preferences?: Pick<TrainingPreferences, 'setsPerExposure'>;
}

export function recommendSets(input: SetsInput): SetsRecommendation {
  const policy = input.policy ?? DEFAULT_SETS_POLICY;
  const reasons: SetsReason[] = [];
  const fixed =
    input.preferences?.setsPerExposure.mode === 'fixed'
      ? input.preferences.setsPerExposure.byKind[input.kind]
      : undefined;

  let base = fixed ?? policy.byKind[input.kind];
  reasons.push(fixed === undefined ? 'POLICY_DEFAULT' : 'USER_FIXED');
  if (input.phase === 'deload') {
    base = Math.max(1, Math.round(base * policy.deloadFactor));
    reasons.push('PHASE_DELOAD');
  }
  if (input.lighterDay) {
    base = 1;
    reasons.push('LIGHTER_DAY');
  }

  // What the muscles can take: the exposure counts as whole sets for each of its main muscles.
  const room = (rooms: Partial<Record<MuscleGroup, number>>) =>
    Math.floor(
      Math.min(policy.plannerMax, ...input.primaryMuscles.map((m) => rooms[m] ?? Infinity)),
    );
  const byDay = room(input.room.dayRoom);
  const byWeek = room(input.room.weekRoom);
  let byTime = policy.plannerMax;
  if (input.room.fitsTime) {
    byTime = 0;
    for (let n = 1; n <= policy.plannerMax; n += 1) if (input.room.fitsTime(n)) byTime = n;
  }

  const hi = Math.min(byDay, byWeek, byTime);
  if (hi < base) {
    if (byDay === hi) reasons.push('DAY_ROOM');
    if (byWeek === hi) reasons.push('WEEK_ROOM');
    if (byTime === hi) reasons.push('TIME');
  }
  const advisable: [number, number] = [1, policy.technicalMax];
  if (hi < 1) {
    return { recommended: 0, allowed: null, advisable, reasons: [...reasons, 'NO_ROOM'] };
  }
  return {
    recommended: Math.min(base, hi),
    allowed: [1, hi],
    advisable,
    reasons,
  };
}
