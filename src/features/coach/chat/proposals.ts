import {
  summarizePlan,
  previewPlanChange,
  validatePlanIntent,
  validateExtraQuestion,
} from '@/features/plan/coachPreview';
import { randomUUID } from 'expo-crypto';
import { type ToolInput, type ToolOutput } from '@/ai/contract/chatTools';
import type { ToolEnvironment } from '@/ai/tools/implementations';
import { getDayBoundaryHour } from '@/db/repositories/profile';
import { saveCoachWeek } from '@/db/repositories/weekPlan';
import { findInProgressWorkout } from '@/db/repositories/workouts';
import { cleanText } from '@/ai/context/redact';
import { isTrainingDay } from '@/domain/plan/constraints';
import { extraSessionOptions, planCustom } from '@/domain/plan/extra';
import type { SessionPlan } from '@/domain/plan/types';
import { syncWeek, type SyncResult } from '@/domain/plan/weekSync';
import { addDays, trainingDate } from '@/domain/time/trainingDate';
import { startExtraSession } from '@/features/extra/actions';
import { withPlanningLock } from '@/features/plan/computeToday';
import { loadPlanningSnapshot, planningSnapshotKey } from '@/features/plan/planningSnapshot';

export type ProposalSummary = ToolOutput<'proposePlanChange'> | ToolOutput<'proposeExtraSession'>;
export type ProposalStatus = 'pending' | 'applying' | 'applied' | 'rejected' | 'stale' | 'failed';
export interface ProposalView {
  id: string;
  summary: ProposalSummary;
  note: string;
}
type Draft = ProposalView & { fingerprint: string } & (
    | { kind: 'plan'; intent: ToolInput<'proposePlanChange'> }
    | { kind: 'extra'; slotIds: string[]; plan: SessionPlan }
  );

export class ProposalChangedError extends Error {}

export interface ProposalDeps {
  snapshot: typeof loadPlanningSnapshot;
  inProgress: typeof findInProgressWorkout;
  boundary: typeof getDayBoundaryHour;
  save: typeof saveCoachWeek;
  start: typeof startExtraSession;
  id: () => string;
  now: () => Date;
  lock: typeof withPlanningLock;
}
const defaultDeps: ProposalDeps = {
  snapshot: loadPlanningSnapshot,
  inProgress: findInProgressWorkout,
  boundary: getDayBoundaryHour,
  save: saveCoachWeek,
  start: startExtraSession,
  id: randomUUID,
  now: () => new Date(),
  lock: withPlanningLock,
};

/** Drafts live only in this conversation. Tools never write; only apply() may cross the consent boundary. */
export function createProposalController(deps: ProposalDeps = defaultDeps) {
  const drafts = new Map<string, Draft>();
  const applying = new Set<string>();
  let question = '';
  let expectedDate: string | null = null;
  let revision = 0;
  const tools: Pick<ToolEnvironment, 'week' | 'proposeChange' | 'proposeExtra'> = {
    async week() {
      const s = await deps.snapshot();
      const active = await deps.inProgress();
      const todayActive = active?.trainingDate === s.input.asOf;
      const sync = syncWeek({
        ...s.input,
        trainedDates: new Set([...s.input.trainedDates, ...(todayActive ? [s.input.asOf] : [])]),
      });
      return {
        asOf: s.input.asOf,
        days: Array.from({ length: 7 }, (_, i) => {
          const date = addDays(s.input.asOf, i);
          const row =
            sync.rows.find((d) => d.date === date) ?? s.input.stored.find((d) => d.date === date);
          const status =
            date === s.input.asOf && todayActive
              ? 'in_progress'
              : s.input.trainedDates.has(date)
                ? 'done'
                : 'planned';
          return summarizePlan(
            s,
            date,
            date === s.input.asOf && todayActive ? active.plan : (row?.forecast ?? null),
            status,
            status === 'planned' && row?.forecast == null,
          );
        }),
      };
    },
    async proposeChange(intent) {
      const turn = revision;
      const error = validatePlanIntent(intent, question);
      if (error) return error;
      intent = { ...intent, note: cleanText(intent.note) };
      if (await deps.inProgress()) return { error: 'in_progress' };
      const s = await deps.snapshot();
      if (turn !== revision) return { error: 'failed' };
      if (expectedDate !== null && s.input.asOf !== expectedDate) return { error: 'date_changed' };
      const id = deps.id();
      const { summary } = previewPlanChange(s, intent, id);
      drafts.set(id, {
        id,
        kind: 'plan',
        summary,
        note: intent.note,
        fingerprint: planningSnapshotKey(s),
        intent,
      });
      return summary;
    },
    async proposeExtra(intent) {
      const turn = revision;
      const questionError = validateExtraQuestion(question);
      if (questionError) return questionError;
      if (await deps.inProgress()) return { error: 'in_progress' };
      const s = await deps.snapshot();
      if (turn !== revision) return { error: 'failed' };
      if (expectedDate !== null && s.input.asOf !== expectedDate) return { error: 'date_changed' };
      if (!s.input.trainedDates.has(s.input.asOf)) return { error: 'finish_first' };
      if (!isTrainingDay(s.input.asOf, s.input.week!, s.input.constraints ?? []))
        return { error: 'rest_day' };
      const input = { ...s.input, asOf: s.input.asOf, block: s.advance.block };
      const focus = [...new Set(intent.focusMuscles)];
      const slotIds = extraSessionOptions(input)
        .filter(
          (o) =>
            o.item &&
            input.catalog[o.item.exerciseId]!.primaryMuscles.some((m) => focus.includes(m)),
        )
        .map((o) => o.slotId);
      const plan = planCustom(input, slotIds);
      if (!plan.exercises.length) return { error: 'no_plan' };
      const id = deps.id();
      const summary: ToolOutput<'proposeExtraSession'> = {
        proposalId: id,
        kind: 'extra',
        requiresAcceptance: true,
        focusMuscles: focus,
        day: summarizePlan(s, plan.date, plan),
      };
      drafts.set(id, {
        id,
        kind: 'extra',
        summary,
        note: '',
        fingerprint: planningSnapshotKey(s),
        slotIds,
        plan,
      });
      return summary;
    },
  };
  return {
    tools,
    beginTurn(text: string, asOf: string | null = null) {
      revision += 1;
      drafts.clear();
      question = cleanText(text);
      expectedDate = asOf;
    },
    resolve(id: string): ProposalView | null {
      const draft = drafts.get(id);
      return draft ? { id, summary: draft.summary, note: draft.note } : null;
    },
    reject(id: string) {
      drafts.delete(id);
    },
    async apply(id: string): Promise<{ workoutId?: string }> {
      const draft = drafts.get(id);
      if (!draft || applying.has(id)) throw new ProposalChangedError();
      applying.add(id);
      try {
        return await deps.lock(async () => {
          const s = await deps.snapshot();
          if (
            drafts.get(id) !== draft ||
            (await deps.inProgress()) ||
            planningSnapshotKey(s) !== draft.fingerprint ||
            trainingDate(deps.now(), await deps.boundary()) !== s.input.asOf
          )
            throw new ProposalChangedError();
          if (draft.kind === 'extra') {
            const workoutId = await deps.start(draft.slotIds, draft.plan, { proposalId: id });
            drafts.delete(id);
            return { workoutId };
          }
          const prepared = previewPlanChange(s, draft.intent, id);
          if (JSON.stringify(prepared.summary) !== JSON.stringify(draft.summary))
            throw new ProposalChangedError();
          const sync: SyncResult = prepared.sync;
          await deps.save(
            id,
            prepared.constraints,
            {
              rows: sync.rows,
              statusUpdates: sync.statusUpdates,
              trigger: 'coach',
              fromDate: sync.from,
              changes: sync.changes,
            },
            s.current,
            s.advance,
            s.input.asOf,
            deps.now(),
          );
          drafts.delete(id);
          return {};
        });
      } finally {
        applying.delete(id);
      }
    },
  };
}
