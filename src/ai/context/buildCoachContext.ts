import { exerciseTrend, type TrendSet } from '@/domain/coach/exerciseTrend';
import { kneeConstraints } from '@/domain/coach/constraints';
import { deriveSignals } from '@/domain/coach/signals';
import { MUSCLE_GROUPS } from '@/domain/coach/vocabulary';
import { COACH_CONFIG } from '@/domain/config/training';
import { countWorkingSets, durationMinutes, groupSetsByExercise } from '@/domain/history/summary';
import { round1 } from '@/domain/metrics/series';
import { addDays } from '@/domain/time/trainingDate';

import { coachContextSchema, type CoachContext, type LoadContext } from '../contract/coachContext';
import { bodySummary, loadOf, volumeWeek } from './derive';
import { redactNotes, type NoteOmissions, type RawNote } from './redact';
import type { CoachSource, SourceSet } from './source';

export interface BuiltCoachContext {
  context: CoachContext;
  /** What was held back, so the screen can say so. Never sent. */
  omissions: NoteOmissions;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/**
 * Logs → the context a model sees (AI-INTEGRACJA §4.1, F1).
 *
 * Everything the summary may quote is computed here, in code: weekly
 * volume, trends, the weight average, the signals. The model is given the
 * results and asked to comment (I1, I6). Free text goes through
 * `redactNotes` first (I3, I4). The output is parsed through the strict
 * contract schema, so it cannot carry a field nobody listed (I9).
 */
export function buildCoachContext(source: CoachSource, cfg = COACH_CONFIG): BuiltCoachContext {
  const { asOf } = source;
  const windowStart = addDays(asOf, -(cfg.windowDays - 1));
  const inWindow = (date: string) => date >= windowStart && date <= asOf;
  const exerciseById = new Map(source.exercises.map((e) => [e.id, e]));
  const nameOf = (exerciseId: string) => exerciseById.get(exerciseId)?.name ?? exerciseId;

  // --- sessions -----------------------------------------------------------
  const windowWorkouts = source.completedWorkouts
    .filter((w) => inWindow(w.trainingDate))
    .sort(
      (a, b) =>
        a.trainingDate.localeCompare(b.trainingDate) || a.startedAt.localeCompare(b.startedAt),
    );

  const workingSets = source.sets.filter((s) => !s.isWarmup);
  const setsByWorkout = new Map<string, SourceSet[]>();
  for (const set of workingSets) {
    const list = setsByWorkout.get(set.workoutId);
    if (list) list.push(set);
    else setsByWorkout.set(set.workoutId, [set]);
  }

  const trendInput = new Map<string, TrendSet[][]>();
  const sessions: CoachContext['sessions'] = windowWorkouts.map((workout) => {
    const sets = setsByWorkout.get(workout.id) ?? [];
    const groups = groupSetsByExercise(sets);
    for (const group of groups) {
      const perSession = group.sets.map((s) => ({
        load: loadOf(s),
        reps: s.reps,
        timeSec: s.timeSec,
      }));
      trendInput.set(group.exerciseId, [...(trendInput.get(group.exerciseId) ?? []), perSession]);
    }
    return {
      date: workout.trainingDate,
      template: workout.templateName,
      durationMin: durationMinutes(workout.startedAt, workout.finishedAt),
      sessionRpe: workout.sessionRpe,
      workingSets: countWorkingSets(sets),
      exercises: groups.map((group) => ({
        exerciseId: group.exerciseId,
        name: nameOf(group.exerciseId),
        sets: group.sets.map((s) => ({
          reps: s.reps,
          timeSec: s.timeSec,
          rir: s.rir,
          load: loadOf(s) satisfies LoadContext,
        })),
      })),
    };
  });

  // --- weekly volume, newest week first -----------------------------------
  const weeks = Math.floor(cfg.windowDays / 7);
  const volumeByWeek = Array.from({ length: weeks }, (_, k) =>
    volumeWeek(source, addDays(asOf, -7 * k)),
  );

  // --- exercise trends -----------------------------------------------------
  const trends = [...trendInput.entries()]
    .map(([exerciseId, perSession]) => ({ exerciseId, ...exerciseTrend(perSession, cfg) }))
    .filter((t) => t.verdict !== 'insufficient_data')
    .map((t) => ({ ...t, name: nameOf(t.exerciseId) }));
  const countOf = (verdict: 'improved' | 'maintained' | 'declined') =>
    trends.filter((t) => t.verdict === verdict).length;

  // --- body ----------------------------------------------------------------
  const { weight, waist } = bodySummary(source, windowStart);

  // --- recovery ------------------------------------------------------------
  const logs = source.dailyLogs.filter((l) => inWindow(l.date));
  const present = (values: readonly (number | null)[]) =>
    values.filter((v): v is number => v !== null);
  const highSoreness = MUSCLE_GROUPS.map((muscle) => ({
    muscle,
    days: logs.filter((l) => (l.soreness?.[muscle] ?? 0) >= cfg.highSorenessLevel).length,
  }))
    .filter((m) => m.days > 0)
    .sort((a, b) => b.days - a.days);

  // --- signals and constraints --------------------------------------------
  const completedUpToNow = source.completedWorkouts.filter((w) => w.trainingDate <= asOf);
  const lastSessionDate = completedUpToNow.reduce<string | null>(
    (latest, w) => (latest === null || w.trainingDate > latest ? w.trainingDate : latest),
    null,
  );
  const signals = deriveSignals(
    {
      asOf,
      completedSessionCount: completedUpToNow.length,
      lastSessionDate,
      sleep: logs.flatMap((l) =>
        l.sleepHours === null ? [] : [{ date: l.date, value: l.sleepHours }],
      ),
    },
    cfg,
  );

  // --- notes ---------------------------------------------------------------
  const noteStart = addDays(asOf, -(cfg.noteWindowDays - 1));
  const rawNotes: RawNote[] = [
    ...source.completedWorkouts
      .filter((w) => w.notes !== null && w.trainingDate >= noteStart && w.trainingDate <= asOf)
      .map((w) => ({ date: w.trainingDate, source: 'session' as const, text: w.notes! })),
    ...source.dailyLogs
      .filter((l) => l.note !== null && l.date >= noteStart && l.date <= asOf)
      .map((l) => ({ date: l.date, source: 'daily' as const, text: l.note! })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const { kept, omissions } = redactNotes(rawNotes, cfg);

  const context = coachContextSchema.parse({
    asOf,
    windowDays: cfg.windowDays,
    goal: 'lean_mass_retention_in_deficit',
    constraints: kneeConstraints(source.knee),
    historicalSessionCount: completedUpToNow.length,
    sessionCount: sessions.length,
    signals,
    sessions,
    weeklyVolume: volumeByWeek,
    trends,
    trendSummary: {
      improved: countOf('improved'),
      maintained: countOf('maintained'),
      declined: countOf('declined'),
    },
    weight,
    waist,
    recovery: {
      daysLogged: logs.length,
      avgSleepHours: mean(present(logs.map((l) => l.sleepHours))),
      avgEnergy: mean(present(logs.map((l) => l.energy))),
      avgStress: mean(present(logs.map((l) => l.stress))),
      highSoreness,
    },
    notes: kept,
  });

  return { context, omissions };
}
