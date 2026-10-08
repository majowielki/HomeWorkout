import exercisesJson from '@data/exercises.json';
import slotsJson from '@data/slots.json';
import { slotCatalogueSchema } from '@data/slots.schema';
import type { CoachSource } from '@/ai/context/source';
import type { ToolEnvironment } from '@/ai/tools/implementations';
import { planToday } from '@/domain/plan/today';
import { extraSessionOptions, planCustom } from '@/domain/plan/extra';
import { syncWeek } from '@/domain/plan/weekSync';
import type { HistorySession } from '@/domain/progression/history';
import { loadOfSet } from '@/domain/progression/load';
import type { Exercise } from '@/domain/types';
import { addDays } from '@/domain/time/trainingDate';
import {
  previewPlanChange,
  summarizePlan,
  validatePlanIntent,
  validateExtraQuestion,
} from '@/features/plan/coachPreview';
import type { PlanningSnapshot } from '@/features/plan/planningSnapshot';

/** Same engine and preview functions as the phone, against synthetic rows. No write capability. */
export function syntheticPlanningTools(
  source: CoachSource,
  question: string,
): Pick<ToolEnvironment, 'week' | 'proposeChange' | 'proposeExtra'> {
  const catalog: Record<string, Exercise> = Object.fromEntries(
    (exercisesJson.exercises as Exercise[]).map((e) => [
      e.id,
      { ...e, name: source.exercises.find((row) => row.id === e.id)?.name ?? e.name },
    ]),
  );
  const slots = slotCatalogueSchema.parse(slotsJson).slots;
  const sessions: HistorySession[] = source.completedWorkouts
    .filter((w) => w.trainingDate <= source.asOf)
    .sort((a, b) => a.trainingDate.localeCompare(b.trainingDate))
    .map((w) => ({
      date: w.trainingDate,
      sets: source.sets
        .filter((set) => set.workoutId === w.id)
        .map((set) => ({
          exerciseId: set.exerciseId,
          isWarmup: set.isWarmup,
          reps: set.reps,
          timeSec: set.timeSec,
          rir: set.rir,
          load: loadOfSet(set),
        })),
    }));
  const plannerSource: PlanningSnapshot['source'] = {
    asOf: source.asOf,
    catalog,
    profile: { knee: source.knee },
    excludedIds: [],
    sessions,
    lastSessionDate: sessions.at(-1)?.date ?? null,
    rides: [],
    daily: [...source.dailyLogs],
    calibrations: {},
  };
  const input = {
    ...plannerSource,
    slots,
    eligibility: { profile: plannerSource.profile, excludedIds: new Set<string>() },
    block: null,
  };
  const { advance } = planToday(input);
  const s: PlanningSnapshot = {
    source: plannerSource,
    current: null,
    advance,
    input: {
      ...input,
      block: advance.block,
      stored: [],
      trainedDates: new Set(sessions.map((session) => session.date)),
      week: { restWeekdays: [] },
      constraints: [],
    },
  };
  s.input.stored = syncWeek(s.input).rows;
  const planner = { ...s.input, block: advance.block };
  return {
    async week() {
      const sync = syncWeek(s.input);
      return {
        asOf: source.asOf,
        days: Array.from({ length: 7 }, (_, i) => {
          const date = addDays(source.asOf, i);
          const row = sync.rows.find((d) => d.date === date);
          return summarizePlan(
            s,
            date,
            row?.forecast ?? null,
            s.input.trainedDates.has(date) ? 'done' : 'planned',
            !s.input.trainedDates.has(date) && !row?.forecast,
          );
        }),
      };
    },
    async proposeChange(intent) {
      const invalid = validatePlanIntent(intent, question);
      return invalid ?? previewPlanChange(s, intent, 'eval-plan-proposal').summary;
    },
    async proposeExtra({ focusMuscles }) {
      const invalid = validateExtraQuestion(question);
      if (invalid) return invalid;
      if (!s.input.trainedDates.has(source.asOf)) return { error: 'finish_first' };
      const selected = extraSessionOptions(planner)
        .filter(
          (o) =>
            o.item &&
            catalog[o.item.exerciseId]!.primaryMuscles.some((m) => focusMuscles.includes(m)),
        )
        .map((o) => o.slotId);
      const plan = planCustom(planner, selected);
      return plan.exercises.length
        ? {
            kind: 'extra',
            requiresAcceptance: true,
            proposalId: 'eval-extra-proposal',
            focusMuscles,
            day: summarizePlan(s, source.asOf, plan),
          }
        : { error: 'no_plan' };
    },
  };
}
