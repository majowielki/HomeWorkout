/**
 * The rules engine's plan for a synthetic history — what the chat's
 * `getPlanExplanation` reads in tests and evaluation cases. The plan is
 * computed by the real engine from the same rows the other tools read,
 * so a case about "why no squats today" is answered by the code that
 * decides it on the phone.
 */
import exercisesJson from '@data/exercises.json';
import slotsJson from '@data/slots.json';
import { slotCatalogueSchema } from '@data/slots.schema';

import { planToday } from '@/domain/plan/today';
import type { HistorySession } from '@/domain/progression/history';
import { loadOfSet } from '@/domain/progression/load';
import type { Exercise } from '@/domain/types';

import type { CoachSource } from '../context/source';
import type { PlanLookup } from '../tools/implementations';

const CATALOG: Record<string, Exercise> = Object.fromEntries(
  (exercisesJson as { exercises: Exercise[] }).exercises.map((e) => [e.id, e]),
);
const SLOTS = slotCatalogueSchema.parse(slotsJson).slots;
const SLOT_NAMES = Object.fromEntries(SLOTS.map((s) => [s.id, s.name]));

/** Today's plan for the history, as the phone would compute it before a session; other days have none. */
export function syntheticPlan(source: CoachSource, daysAgo: number): PlanLookup | null {
  if (daysAgo !== 0) return null;

  const dateOf = new Map(source.completedWorkouts.map((w) => [w.id, w.trainingDate]));
  const byDate = new Map<string, HistorySession>();
  const sets = [...source.sets].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  for (const set of sets) {
    const date = dateOf.get(set.workoutId);
    if (date === undefined) continue;
    const session = byDate.get(date) ?? { date, sets: [] };
    session.sets.push({
      exerciseId: set.exerciseId,
      isWarmup: set.isWarmup,
      reps: set.reps,
      timeSec: set.timeSec,
      rir: set.rir,
      load: loadOfSet(set),
    });
    byDate.set(date, session);
  }
  const sessions = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const dates = source.completedWorkouts.map((w) => w.trainingDate).filter((d) => d <= source.asOf);

  const { plan } = planToday({
    asOf: source.asOf,
    catalog: CATALOG,
    slots: SLOTS,
    eligibility: { profile: { knee: source.knee }, excludedIds: new Set() },
    block: null,
    sessions,
    lastSessionDate: dates.length > 0 ? dates.sort()[dates.length - 1]! : null,
    rides: [],
    daily: source.dailyLogs.map((d) => ({
      date: d.date,
      sleepHours: d.sleepHours,
      energy: d.energy,
      soreness: d.soreness,
    })),
  });
  return { plan, source: 'today', slotNames: SLOT_NAMES };
}
