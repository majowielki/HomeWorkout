import { exerciseTrend } from '@/domain/coach/exerciseTrend';
import { fold } from '@/domain/coach/text';
import { countWorkingSets, durationMinutes, groupSetsByExercise } from '@/domain/history/summary';
import { loadOfSet } from '@/domain/progression/load';
import { addDays } from '@/domain/time/trainingDate';

import {
  TOOL_LIMITS,
  type ToolError,
  type ToolInput,
  type ToolName,
  type ToolOutput,
} from '../contract/chatTools';
import { bodySummary, volumeWeek } from '../context/derive';
import type { CoachSource, SourceSet } from '../context/source';

/**
 * What the tools need from the outside: rows, in domain terms. The phone
 * reads them from SQLite; a test hands over a synthetic history. Nothing
 * here is a Drizzle type, so every tool runs in a test with no database.
 */
export interface ToolEnvironment {
  /**
   * Rows for the `days` days ending today. Completed sessions are always
   * all of them (a count needs them); sets and measurements are limited to
   * the window.
   */
  load(days: number): Promise<CoachSource>;
}

type Result<N extends ToolName> = ToolOutput<N> | ToolError;
type Implementation<N extends ToolName> = (
  input: ToolInput<N>,
  env: ToolEnvironment,
) => Promise<Result<N>>;

/** How far back "recent sessions" looks: a session older than this is not described, only counted. */
const RECENT_WINDOW_DAYS = TOOL_LIMITS.bodyDays.max;

const workingSetsOf = (source: CoachSource, workoutId: string): SourceSet[] =>
  source.sets.filter((s) => s.workoutId === workoutId && !s.isWarmup);

const nameOf = (source: CoachSource, exerciseId: string) =>
  source.exercises.find((e) => e.id === exerciseId)?.name ?? exerciseId;

/**
 * One entry per tool, and the type says every tool in the contract must
 * have one: add a name to `TOOL_NAMES` and this object stops compiling
 * until the tool exists.
 *
 * Each returns figures computed here, in code, never raw rows. The model
 * quotes them (I6); it does not derive them (I1).
 */
export const TOOL_IMPLEMENTATIONS: { [N in ToolName]: Implementation<N> } = {
  async getRecentSessions({ count }, env) {
    const source = await env.load(RECENT_WINDOW_DAYS);
    const windowStart = addDays(source.asOf, -(RECENT_WINDOW_DAYS - 1));
    const done = source.completedWorkouts
      .filter((w) => w.trainingDate <= source.asOf)
      .sort(
        (a, b) =>
          b.trainingDate.localeCompare(a.trainingDate) || b.startedAt.localeCompare(a.startedAt),
      );

    const sessions = done
      .filter((w) => w.trainingDate >= windowStart)
      .slice(0, count)
      .map((workout) => {
        const sets = workingSetsOf(source, workout.id);
        return {
          date: workout.trainingDate,
          durationMin: durationMinutes(workout.startedAt, workout.finishedAt),
          sessionRpe: workout.sessionRpe,
          workingSets: countWorkingSets(sets),
          exercises: groupSetsByExercise(sets).map((group) => ({
            id: group.exerciseId,
            name: nameOf(source, group.exerciseId),
            sets: group.sets.length,
          })),
        };
      });
    return { totalCompleted: done.length, sessions };
  },

  async getExerciseHistory({ exerciseId, weeks }, env) {
    const source = await env.load(weeks * 7);
    const exercise = source.exercises.find((e) => e.id === exerciseId);
    if (!exercise) return { error: 'unknown_exercise' };

    const windowStart = addDays(source.asOf, -(weeks * 7 - 1));
    const appearances = source.completedWorkouts
      .filter((w) => w.trainingDate >= windowStart && w.trainingDate <= source.asOf)
      .sort(
        (a, b) =>
          a.trainingDate.localeCompare(b.trainingDate) || a.startedAt.localeCompare(b.startedAt),
      )
      .map((workout) => ({
        workout,
        sets: workingSetsOf(source, workout.id)
          .filter((s) => s.exerciseId === exerciseId)
          .sort((a, b) => a.setIndex - b.setIndex || a.loggedAt.localeCompare(b.loggedAt)),
      }))
      .filter((appearance) => appearance.sets.length > 0);

    const { verdict } = exerciseTrend(
      appearances.map(({ sets }) =>
        sets.map((s) => ({ load: loadOfSet(s), reps: s.reps, timeSec: s.timeSec })),
      ),
    );
    return {
      exercise: { id: exercise.id, name: exercise.name },
      weeks,
      sessionCount: appearances.length,
      verdict,
      sessions: appearances.slice(-TOOL_LIMITS.historySessionsShown).map(({ workout, sets }) => ({
        date: workout.trainingDate,
        sets: sets.map((s) => ({
          reps: s.reps,
          timeSec: s.timeSec,
          rir: s.rir,
          load: loadOfSet(s),
        })),
      })),
    };
  },

  async getWeeklyVolume({ weeksAgo }, env) {
    const source = await env.load(7 * (weeksAgo + 1));
    return volumeWeek(source, addDays(source.asOf, -7 * weeksAgo));
  },

  async getBodyTrend({ days }, env) {
    const source = await env.load(days);
    return { days, ...bodySummary(source, addDays(source.asOf, -(days - 1))) };
  },

  async findExercises({ muscle, query }, env) {
    const needle = fold(query ?? '').trim();
    if (muscle === undefined && needle === '') return { error: 'invalid_input' };

    // The catalogue is not windowed; one day is the cheapest load that returns it.
    const { exercises } = await env.load(1);
    const matches = exercises
      .filter(
        (e) =>
          (muscle === undefined || e.primaryMuscles.includes(muscle)) &&
          fold(e.name).includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      total: matches.length,
      exercises: matches.slice(0, TOOL_LIMITS.findResults).map((e) => ({
        id: e.id,
        name: e.name,
        primaryMuscles: [...e.primaryMuscles],
      })),
    };
  },
};
