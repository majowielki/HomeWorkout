import { exerciseTrend } from '@/domain/coach/exerciseTrend';
import { fold } from '@/domain/coach/text';
import { countWorkingSets, durationMinutes, groupSetsByExercise } from '@/domain/history/summary';
import { type DayReason, type SkipReason } from '@/domain/plan/reasons';
import type { SessionPlan } from '@/domain/plan/types';
import { loadOfSet } from '@/domain/progression/load';
import { addDays } from '@/domain/time/trainingDate';
import { SHORTFALL_REASONS } from '@/domain/types';

import {
  TOOL_LIMITS,
  PLAN_DAY_REASONS,
  PLAN_SKIP_REASONS,
  type ToolError,
  type ToolInput,
  type ToolName,
  type ToolOutput,
} from '../contract/chatTools';
import { bodySummary, volumeWeek } from '../context/derive';
import type { CoachSource, SourceSet } from '../context/source';

/*
 * Codes known to contract v3, including requests. Unknown historical codes
 * remain on the phone instead of breaking an otherwise readable plan.
 */
function inContractDay(code: DayReason): code is (typeof PLAN_DAY_REASONS)[number] {
  return (PLAN_DAY_REASONS as readonly string[]).includes(code);
}

function inContractSkip(code: SkipReason): code is (typeof PLAN_SKIP_REASONS)[number] {
  return (PLAN_SKIP_REASONS as readonly string[]).includes(code);
}

/**
 * What the tools need from the outside: rows, in domain terms. The phone
 * reads them from SQLite; a test hands over a synthetic history. Nothing
 * here is a Drizzle type, so every tool runs in a test with no database.
 */
/** A day's plan from the rules engine, as the phone has it (SPEC §10.5). */
export interface PlanLookup {
  plan: SessionPlan;
  /** `session`: frozen when that day's session started; `today`: computed now. */
  source: 'session' | 'today';
  /** Slot id to its Polish name, from the shipped data. */
  slotNames: Readonly<Record<string, string>>;
}

export interface ToolEnvironment {
  /**
   * Rows for the `days` days ending today. Completed sessions are always
   * all of them (a count needs them); sets and measurements are limited to
   * the window.
   */
  load(days: number): Promise<CoachSource>;
  /** The plan for the day `daysAgo` days before today, or null when that day has none. */
  plan(daysAgo: number): Promise<PlanLookup | null>;
  week?(): Promise<ToolOutput<'getWeekPlan'> | ToolError>;
  proposeChange?(
    input: ToolInput<'proposePlanChange'>,
  ): Promise<ToolOutput<'proposePlanChange'> | ToolError>;
  proposeExtra?(
    input: ToolInput<'proposeExtraSession'>,
  ): Promise<ToolOutput<'proposeExtraSession'> | ToolError>;
  /** The engine's options for composing one day (ADR 0006). */
  dayOptions?(input: ToolInput<'getDayOptions'>): Promise<ToolOutput<'getDayOptions'> | ToolError>;
  /** A preview of days composed from those options; nothing is stored. */
  proposeDay?(
    input: ToolInput<'proposeDayPlan'>,
  ): Promise<ToolOutput<'proposeDayPlan'> | ToolError>;
  /** The workout under way, the engine's assessment of a change to it, and a card for the person (contract 7). */
  activeSession?(): Promise<ToolOutput<'getActiveSession'> | ToolError>;
  assessChange?(
    input: ToolInput<'assessSessionChange'>,
  ): Promise<ToolOutput<'assessSessionChange'> | ToolError>;
  proposeSessionChange?(
    input: ToolInput<'proposeSessionChange'>,
  ): Promise<ToolOutput<'proposeSessionChange'> | ToolError>;
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
  async getWeekPlan(_input, env) {
    return env.week ? env.week() : { error: 'failed' };
  },
  async proposePlanChange(input, env) {
    return env.proposeChange ? env.proposeChange(input) : { error: 'failed' };
  },
  async proposeExtraSession(input, env) {
    return env.proposeExtra ? env.proposeExtra(input) : { error: 'failed' };
  },
  async getDayOptions(input, env) {
    return env.dayOptions ? env.dayOptions(input) : { error: 'failed' };
  },
  async proposeDayPlan(input, env) {
    return env.proposeDay ? env.proposeDay(input) : { error: 'failed' };
  },
  async getActiveSession(_input, env) {
    return env.activeSession ? env.activeSession() : { error: 'no_active_session' };
  },
  async assessSessionChange(input, env) {
    return env.assessChange ? env.assessChange(input) : { error: 'no_active_session' };
  },
  async proposeSessionChange(input, env) {
    return env.proposeSessionChange ? env.proposeSessionChange(input) : { error: 'failed' };
  },
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
            shortfalls: SHORTFALL_REASONS.map((reason) => ({
              reason,
              sets: group.sets.filter((s) => s.shortfall === reason).length,
            })).filter((entry) => entry.sets > 0),
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
          shortfall: s.shortfall ?? null,
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

  async getPlanExplanation({ daysAgo }, env) {
    const found = await env.plan(daysAgo);
    if (!found) return { error: 'no_plan' };
    const source = await env.load(1);
    const ref = (id: string) => ({ id, name: nameOf(source, id) });
    const movement = (slotId: string) => found.slotNames[slotId] ?? slotId;
    const { plan } = found;
    return {
      date: plan.date,
      source: found.source,
      blockIndex: plan.blockIndex,
      phase: plan.phase,
      dayReasons: plan.dayReasons.filter(inContractDay),
      signals: plan.signals,
      bike: { minutes: plan.bike.minutes, reasons: plan.bike.reasons },
      exercises: plan.exercises.slice(0, TOOL_LIMITS.planExercisesShown).map((e) => ({
        exercise: ref(e.exerciseId),
        movement: movement(e.slotId),
        sets: e.sets,
        reasons: e.reasons,
      })),
      skipped: plan.skipped
        .flatMap(({ slotId, exerciseId, reason }) =>
          inContractSkip(reason) ? [{ slotId, exerciseId, reason }] : [],
        )
        .slice(0, TOOL_LIMITS.planSkippedShown)
        .map((s) => ({
          movement: movement(s.slotId),
          exercise: s.exerciseId === null ? null : ref(s.exerciseId),
          reason: s.reason,
        })),
    };
  },
};
