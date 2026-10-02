import { fatigueSignals } from '../autoregulation/fatigue';
import { TRAINING_CONFIG } from '../config/training';
import type { Ride } from '../progression/bike';
import type { HistorySession, HistorySet } from '../progression/history';
import { addDays } from '../time/trainingDate';
import type { Exercise, MuscleGroup } from '../types';
import { weeklyVolume } from '../volume/weekly';
import { advanceBlock } from './block';
import { planDay } from './dayPlanner';
import { type EligibilityContext, slotByExercise } from './eligibility';
import type { BlockEvent } from './reasons';
import type { BlockState, DailyReadiness, PlannedExercise, SessionPlan, Slot } from './types';

/** How the synthetic person performs a planned exercise. */
export interface Athlete {
  /** Reps (or seconds) achieved in each set. Default: exactly the target. */
  amount(planned: PlannedExercise, setNumber: number): number;
  /** RIR logged for each set. Default: the lower end of the planned range. */
  rir(planned: PlannedExercise): number;
}

export const FOLLOWS_THE_PLAN: Athlete = {
  amount: (planned) => planned.target,
  rir: (planned) => planned.targetRirMin,
};

export interface SimulationOptions {
  start: string;
  days: number;
  catalog: Readonly<Record<string, Exercise>>;
  slots: readonly Slot[];
  eligibility: EligibilityContext;
  /** Dates without a session; the block still advances. */
  restDays?: ReadonlySet<string>;
  /** The morning log for a date; none by default. */
  daily?: (date: string) => DailyReadiness | null;
  athlete?: Athlete;
}

export interface SimulatedDay {
  date: string;
  block: BlockState;
  events: BlockEvent[];
  /** Null on a rest day. */
  plan: SessionPlan | null;
  /** Weekly working sets per muscle at the end of the day, the plan done. */
  volume: Record<MuscleGroup, number>;
  /** The same, counting only sets where the muscle is primary. */
  primaryVolume: Record<MuscleGroup, number>;
}

/**
 * Runs the engine day by day against a synthetic person who does what the
 * plan says. Pure: it is how the properties of SPEC §10.6 are tested, and
 * how `scripts/simulate-plan.ts` prints a calendar before anyone trains.
 */
export function simulate(opts: SimulationOptions): SimulatedDay[] {
  const athlete = opts.athlete ?? FOLLOWS_THE_PLAN;
  const slotOf = slotByExercise(opts.slots);
  const sessions: HistorySession[] = [];
  const rides: Ride[] = [];
  const daily: DailyReadiness[] = [];
  const out: SimulatedDay[] = [];
  let block: BlockState | null = null;

  for (let i = 0; i < opts.days; i += 1) {
    const date = addDays(opts.start, i);
    const morning = opts.daily?.(date) ?? null;
    if (morning) daily.push(morning);

    const signals = fatigueSignals({ asOf: date, sessions, catalog: opts.catalog, slotOf, daily });
    const advance = advanceBlock(block, {
      asOf: date,
      lastSessionDate: sessions[sessions.length - 1]?.date ?? null,
      signals,
      slots: opts.slots,
      catalog: opts.catalog,
      eligibility: opts.eligibility,
    });
    block = advance.block;

    let plan: SessionPlan | null = null;
    if (!opts.restDays?.has(date)) {
      plan = planDay({
        asOf: date,
        catalog: opts.catalog,
        slots: opts.slots,
        eligibility: opts.eligibility,
        block,
        sessions,
        rides,
        daily,
      });
      sessions.push({ date, sets: perform(plan, athlete) });
      rides.push({
        date,
        minutes: plan.bike.minutes,
        resistance: plan.bike.resistance ?? 3,
        rpe: 5,
      });
    }

    out.push({
      date,
      block,
      events: advance.events,
      plan,
      volume: volumeOn(date, sessions, opts.catalog, false),
      primaryVolume: volumeOn(date, sessions, opts.catalog, true),
    });
  }
  return out;
}

function perform(plan: SessionPlan, athlete: Athlete): HistorySet[] {
  const sets: HistorySet[] = [];
  for (const p of plan.exercises) {
    const base = { exerciseId: p.exerciseId, load: p.load };
    const amount = (n: number) =>
      p.unit === 'sec'
        ? { reps: null, timeSec: athlete.amount(p, n) }
        : { reps: athlete.amount(p, n), timeSec: null };
    if (p.warmupSet) sets.push({ ...base, ...amount(1), isWarmup: true, rir: 5 });
    for (let n = 1; n <= p.sets; n += 1) {
      sets.push({ ...base, ...amount(n), isWarmup: false, rir: athlete.rir(p) });
    }
  }
  return sets;
}

function volumeOn(
  date: string,
  sessions: readonly HistorySession[],
  catalog: Readonly<Record<string, Exercise>>,
  primaryOnly: boolean,
): Record<MuscleGroup, number> {
  const exercises = primaryOnly
    ? Object.fromEntries(Object.values(catalog).map((e) => [e.id, { ...e, secondaryMuscles: [] }]))
    : catalog;
  return weeklyVolume(
    sessions.flatMap((s) =>
      s.sets.map((set) => ({
        exerciseId: set.exerciseId,
        date: s.date,
        isWarmup: set.isWarmup,
        rir: set.rir,
      })),
    ),
    exercises,
    date,
    TRAINING_CONFIG,
  );
}
