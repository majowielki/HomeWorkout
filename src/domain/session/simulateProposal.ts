/**
 * What a proposal would do, before the person is asked (engine v2, 11 §13, D36).
 *
 * The model checks a change with a deterministic simulation instead of guessing at its
 * effect: the same week planner that makes the plan is run twice, once as it stands and
 * once with the proposal, and the two are set side by side. The forecast is a forecast —
 * it lives inside `planWeekV2` and never becomes a result — and nothing here writes.
 *
 * `follows_plan` assumes the person does exactly what is planned; `observed_trend` lets
 * the reps drift by what the last four weeks showed they usually do over or under the target.
 */
import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { TRAINING_CONFIG } from '../config/training';
import type { ExposureRecord } from '../observations/exposure';
import { isPerformed } from '../observations/qualify';
import type { PlanConstraint } from '../plan/constraints';
import type { PlannedSet } from '../plan/planV2';
import { type AthleteV2, FOLLOWS_THE_PLAN_V2 } from '../plan/simulateV2';
import { type WeekInputV2, type WeekPlanV2, planWeekV2 } from '../plan/weekV2';
import { finding, type AssessmentCheck } from '../policy/hardAdvice';
import type { TrainingPreferences } from '../preferences/preferences';
import { STEP_UP_CODES } from '../progression/codes';
import { addDays } from '../time/trainingDate';
import type { MuscleGroup } from '../types';
import { assessSessionChange } from './assess';
import type {
  ActiveSessionState,
  ChangeAssessment,
  SessionChange,
  SessionChangeSnapshot,
} from './types';

export type SimulationHorizon = 7 | 14 | 28;

export type SimulateProposalInput =
  | {
      kind: 'week_change';
      /** Requests as they would be added: rest days, lighter days, muscles left out. */
      constraints: readonly Omit<PlanConstraint, 'id'>[];
    }
  | {
      kind: 'policy_change';
      /** The preferences that would change, e.g. the number of sets per exposure. */
      preferences: Partial<TrainingPreferences>;
    }
  | { kind: 'session_change'; change: SessionChange };

export interface SimulateOptions {
  horizonDays: SimulationHorizon;
  athlete: 'follows_plan' | 'observed_trend';
}

export interface SimulationSummary {
  musclesWeek: Partial<Record<MuscleGroup, { sets: number; min: number; max: number }>>;
  minutesPerDay: number[];
  expectedLoadSteps: number;
  expectedProbes: number;
  deloadTriggered: boolean;
}

export interface SimulationDiff {
  /** Sets per muscle in the last week of the horizon, with the proposal minus without it. */
  musclesWeek: Partial<Record<MuscleGroup, number>>;
  minutesPerDay: number[];
  expectedLoadSteps: number;
  expectedProbes: number;
  /** The proposal brings a deload that the plan as it stands does not. */
  deloadTriggered: boolean;
  /** The days whose choice of exercises is not the same. */
  daysChanged: string[];
}

export interface SimulateProposalResult {
  baseline: SimulationSummary;
  withProposal: SimulationSummary;
  diff: SimulationDiff;
  /** The same findings as an assessment makes, so the model explains them the same way. */
  warnings: AssessmentCheck[];
  /** For a change to the running session: the assessment of it, as `assessSessionChange` gives it. */
  assessment: ChangeAssessment | null;
}

/** Everything the week is planned from, apart from its dates; see `WeekInputV2`. */
export type SimulationBase = Omit<WeekInputV2, 'from' | 'days' | 'kept'> & {
  asOf: string;
  /** Days stored so far; the days that still hold stay as they are (04 §5). */
  kept?: WeekInputV2['kept'];
  /** For a change to the running session. */
  session?: { snap: SessionChangeSnapshot; state: ActiveSessionState };
};

/** How much over or under the target the person has lately been, in reps (the last four weeks). */
export function observedAthlete(records: readonly ExposureRecord[], asOf: string): AthleteV2 {
  const from = addDays(asOf, -27);
  const deltas: number[] = [];
  for (const r of records) {
    if (r.trainingDate < from || r.trainingDate > asOf) continue;
    for (const s of r.sets) {
      const q = s.observation?.amount.value;
      if (!isPerformed(s) || q?.kind !== 'reps' || s.planned.target.kind !== 'reps') continue;
      deltas.push(q.reps - s.planned.target.target);
    }
  }
  const mean = deltas.length === 0 ? 0 : deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const drift = Math.max(-2, Math.min(2, Math.round(mean)));
  return {
    amount: (set: PlannedSet) =>
      set.target.kind === 'reps'
        ? Math.max(1, set.target.target + drift)
        : FOLLOWS_THE_PLAN_V2.amount(set, {} as never),
    rir: FOLLOWS_THE_PLAN_V2.rir,
  };
}

function summarize(week: WeekPlanV2): SimulationSummary {
  const { min, max } = TRAINING_CONFIG.weeklyWorkingSetsPerMuscle;
  const maxOf = (m: MuscleGroup) => TRAINING_CONFIG.maxDirectSetsOverride[m] ?? max;
  const exposures = week.days.flatMap((d) => d.forecast?.exposures ?? []);
  return {
    musclesWeek: Object.fromEntries(
      MUSCLE_GROUPS.map((m) => [m, { sets: week.volume[m], min, max: maxOf(m) }]),
    ) as SimulationSummary['musclesWeek'],
    minutesPerDay: week.days.map((d) =>
      d.forecast === null ? 0 : Math.round(d.forecast.time.exerciseTotal / 60),
    ),
    expectedLoadSteps: exposures.filter((e) => STEP_UP_CODES.includes(e.trace.code as never))
      .length,
    expectedProbes: exposures.filter((e) => e.sets.some((s) => s.role === 'probe')).length,
    deloadTriggered: week.days.some((d) => d.output?.phase === 'deload'),
  };
}

function difference(
  a: SimulationSummary,
  b: SimulationSummary,
  ab: WeekPlanV2,
  bb: WeekPlanV2,
): SimulationDiff {
  const days = ab.days.map((d, i) => ({ before: d, after: bb.days[i]! }));
  return {
    musclesWeek: Object.fromEntries(
      MUSCLE_GROUPS.map((m) => [m, b.musclesWeek[m]!.sets - a.musclesWeek[m]!.sets]).filter(
        ([, delta]) => delta !== 0,
      ),
    ) as SimulationDiff['musclesWeek'],
    minutesPerDay: a.minutesPerDay.map((m, i) => b.minutesPerDay[i]! - m),
    expectedLoadSteps: b.expectedLoadSteps - a.expectedLoadSteps,
    expectedProbes: b.expectedProbes - a.expectedProbes,
    deloadTriggered: Number(b.deloadTriggered) > Number(a.deloadTriggered),
    daysChanged: days
      .filter(
        ({ before, after }) => JSON.stringify(before.selection) !== JSON.stringify(after.selection),
      )
      .map(({ before }) => before.date),
  };
}

/** What the plan would put over the limits the engine keeps to; the forecast itself keeps to the day and the time. */
export function weekWarnings(summary: SimulationSummary): AssessmentCheck[] {
  return MUSCLE_GROUPS.flatMap((m) => {
    const w = summary.musclesWeek[m]!;
    return w.sets > w.max
      ? [finding('WEEK_MAX_EXCEEDED', 'fail', { muscle: m, sets: w.sets, weekMax: w.max })]
      : [];
  });
}

/** The records of a revised plan: what was settled stays as it was, the rest is still to do. */
function recordsOfPlan(
  state: ActiveSessionState,
  plan: ActiveSessionState['plan'],
): ExposureRecord[] {
  const had = new Map(state.records.flatMap((r) => r.sets.map((s) => [s.planned.id, s] as const)));
  const exposures = new Map(state.records.map((r) => [r.exposureId, r]));
  return plan.exposures.map((e) => {
    const old = exposures.get(e.id);
    return {
      exposureId: e.id,
      sessionId: plan.sessionId,
      trainingDate: plan.trainingDate,
      exerciseId: e.exercise.id,
      slotId: e.slotId,
      comparisonKey: e.comparisonKey,
      progressionScope: e.progressionScope,
      sets: e.sets.map(
        (planned) =>
          had.get(planned.id) ?? { planned, disposition: 'pending' as const, observation: null },
      ),
      extra: old?.extra ?? [],
      context: old?.context ?? { abandoned: false, userReduced: false, feel: null, deload: false },
    };
  });
}

export function simulateProposal(
  base: SimulationBase,
  input: SimulateProposalInput,
  options: SimulateOptions,
): SimulateProposalResult {
  const athlete =
    options.athlete === 'follows_plan'
      ? FOLLOWS_THE_PLAN_V2
      : observedAthlete(base.records, base.asOf);
  const from = base.running != null ? addDays(base.asOf, 1) : base.asOf;
  const plan = (patch: Partial<WeekInputV2>) =>
    planWeekV2({ ...base, from, days: options.horizonDays, athlete, ...patch });

  let withInput: Partial<WeekInputV2> = {};
  let baselineInput: Partial<WeekInputV2> = {};
  let assessment: ChangeAssessment | null = null;
  if (input.kind === 'week_change') {
    withInput = {
      constraints: [
        ...(base.constraints ?? []),
        ...input.constraints.map((c, i) => ({ ...c, id: `proposal-${i}` })),
      ],
    };
  } else if (input.kind === 'policy_change') {
    withInput = { preferences: { ...base.preferences, ...input.preferences } };
  } else if (base.session !== undefined) {
    const { snap, state } = base.session;
    assessment = assessSessionChange(snap, state, input.change, { maxAlternatives: 0 });
    const others = base.records.filter((r) => r.sessionId !== state.plan.sessionId);
    baselineInput = { records: [...others, ...state.records], running: state.plan };
    withInput = {
      records: [
        ...others,
        ...(assessment.patch === null
          ? state.records
          : recordsOfPlan(state, assessment.patch.plan)),
      ],
      running: assessment.patch?.plan ?? state.plan,
    };
  }
  const before = plan(baselineInput);
  const after = plan(withInput);
  const a = summarize(before);
  const b = summarize(after);
  return {
    baseline: a,
    withProposal: b,
    diff: difference(a, b, before, after),
    warnings: [
      ...(assessment?.checks.filter((c) => c.status !== 'pass') ?? []),
      ...weekWarnings(b),
    ],
    assessment,
  };
}
