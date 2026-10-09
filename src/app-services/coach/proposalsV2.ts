/**
 * The proposals of the chat on the week of engine v2 (contract 7): a change of the plan, an extra
 * session, a day composed with the coach. The tools only preview — a draft lives for the question it
 * was made in — and only `apply` crosses the consent boundary, against the same preview made again
 * on the database as it is then. Anything that moved in between (a request, a result, the day, a
 * running workout) makes the card stale instead of applying something the person did not see.
 */
import { randomUUID } from 'expo-crypto';
import {
  describeDayOptions,
  describeWeek,
  previewDayPlan,
  previewPlanChange,
  proposeDayPreview,
  summarizeDay,
  validateExtraQuestion,
  validatePlanIntent,
  type WeekContext,
} from '@/ai/tools/planPreviewV2';
import type { ToolEnvironment } from '@/ai/tools/implementations';
import { cleanText } from '@/ai/context/redact';
import type { ToolInput, ToolOutput } from '@/ai/contract/chatTools';
import { isTrainingDay, TRAIN_DAILY } from '@/domain/plan/constraints';
import { summaryOf } from '@/domain/plan/weekV2';
import { acceptDay, type DayRequest, previewDay } from '@/db/repositories/planningV2';
import {
  hasRunningWorkout,
  loadWeekContext,
  runningPlanOn,
  saveCoachWeekV2,
} from '@/db/repositories/weekPlanV2';

export type ProposalSummary =
  | ToolOutput<'proposePlanChange'>
  | ToolOutput<'proposeExtraSession'>
  | ToolOutput<'proposeDayPlan'>;
export interface ProposalView {
  id: string;
  summary: ProposalSummary;
  note: string;
}
type Draft = ProposalView & { fingerprint: string } & (
    | { kind: 'plan'; intent: ToolInput<'proposePlanChange'> }
    | { kind: 'extra'; request: DayRequest; planHash: string }
    | { kind: 'compose'; intent: ToolInput<'proposeDayPlan'> }
  );

export class ProposalChangedError extends Error {}

export interface ProposalDepsV2 {
  context: () => WeekContext;
  /** A workout is under way. */
  inProgress: () => boolean;
  id: () => string;
  now: () => Date;
}
const defaultDeps: ProposalDepsV2 = {
  context: () => loadWeekContext(),
  inProgress: hasRunningWorkout,
  id: randomUUID,
  now: () => new Date(),
};

let queue: Promise<unknown> = Promise.resolve();
/** One acceptance at a time, so two cards cannot overwrite each other. */
export function withPlanningLockV2<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

/** The fingerprint of what a card was made from; a different one is a different week. */
const keyOf = (ctx: WeekContext) =>
  JSON.stringify({
    asOf: ctx.asOf,
    snapshot: ctx.snapshotFingerprint,
    stored: ctx.stored.map((d) => [d.date, d.selection, d.status]),
    trained: [...ctx.trainedDates].sort(),
  });

/** Drafts live only in this conversation. Tools never write; only apply() may cross the consent boundary. */
export function createProposalControllerV2(deps: ProposalDepsV2 = defaultDeps) {
  const drafts = new Map<string, Draft>();
  const applying = new Set<string>();
  let question = '';
  let expectedDate: string | null = null;
  let revision = 0;

  /** The week for this question, or the tool error that stops it. */
  function fresh(turn: number): WeekContext | { error: 'failed' | 'date_changed' } {
    const ctx = deps.context();
    if (turn !== revision) return { error: 'failed' };
    if (expectedDate !== null && ctx.asOf !== expectedDate) return { error: 'date_changed' };
    return ctx;
  }

  const tools: Pick<
    ToolEnvironment,
    'week' | 'proposeChange' | 'proposeExtra' | 'dayOptions' | 'proposeDay'
  > = {
    async week() {
      const ctx = deps.context();
      const live = runningPlanOn(ctx.asOf);
      return describeWeek(ctx, live === null ? null : { plan: live });
    },
    async proposeChange(intent) {
      const turn = revision;
      const error = validatePlanIntent(intent, question);
      if (error) return error;
      intent = { ...intent, note: cleanText(intent.note) };
      if (deps.inProgress()) return { error: 'in_progress' };
      const ctx = fresh(turn);
      if ('error' in ctx) return ctx;
      const id = deps.id();
      const { summary } = previewPlanChange(ctx, intent, id);
      drafts.set(id, {
        id,
        kind: 'plan',
        summary,
        note: intent.note,
        fingerprint: keyOf(ctx),
        intent,
      });
      return summary;
    },
    async proposeExtra(intent) {
      const turn = revision;
      const questionError = validateExtraQuestion(question);
      if (questionError) return questionError;
      if (deps.inProgress()) return { error: 'in_progress' };
      const ctx = fresh(turn);
      if ('error' in ctx) return ctx;
      if (!ctx.trainedDates.has(ctx.asOf)) return { error: 'finish_first' };
      if (!isTrainingDay(ctx.asOf, ctx.week ?? TRAIN_DAILY, ctx.constraints ?? []))
        return { error: 'rest_day' };
      const focus = [...new Set(intent.focusMuscles)];
      const id = deps.id();
      const only = ctx.slots
        .filter((slot) => slot.kind !== 'filler')
        .filter((slot) => {
          const exercise = ctx.catalog[ctx.block?.selections[slot.id] ?? ''];
          return exercise?.primaryMuscles.some((m) => focus.includes(m));
        })
        .map((slot) => ({ slotId: slot.id }));
      if (only.length === 0) return { error: 'no_plan' };
      const request: DayRequest = { sessionId: id, intent: 'extra', kind: 'extra', only };
      const shown = previewDay(request, deps.now());
      const result = shown.output.result;
      if (result.kind !== 'ready' && result.kind !== 'adjusted') return { error: 'no_plan' };
      const summary: ToolOutput<'proposeExtraSession'> = {
        proposalId: id,
        kind: 'extra',
        requiresAcceptance: true,
        focusMuscles: focus,
        day: summarizeDay(ctx, ctx.asOf, {
          forecast: result.plan,
          summary: summaryOf(shown.output, result.plan, false),
        }),
      };
      drafts.set(id, {
        id,
        kind: 'extra',
        summary,
        note: '',
        fingerprint: keyOf(ctx),
        request,
        planHash: result.plan.audit.planHash,
      });
      return summary;
    },
    async dayOptions({ daysAhead }) {
      const ctx = fresh(revision);
      return 'error' in ctx ? ctx : describeDayOptions(ctx, daysAhead);
    },
    async proposeDay(intent) {
      const turn = revision;
      if (deps.inProgress()) return { error: 'in_progress' };
      const ctx = fresh(turn);
      if ('error' in ctx) return ctx;
      const id = deps.id();
      const result = proposeDayPreview(ctx, intent, question, id);
      if ('error' in result) return result.error;
      const { summary } = result.preview;
      if (summary.proposalId !== null)
        drafts.set(id, {
          id,
          kind: 'compose',
          summary,
          note: result.intent.note,
          fingerprint: keyOf(ctx),
          intent: result.intent,
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
        return await withPlanningLockV2(async () => {
          const ctx = deps.context();
          if (drafts.get(id) !== draft || deps.inProgress() || keyOf(ctx) !== draft.fingerprint)
            throw new ProposalChangedError();
          if (draft.kind === 'extra') {
            const started = acceptDay(
              {
                commandId: id,
                request: draft.request,
                expectedPlanHash: draft.planHash,
                timeZone: null,
              },
              deps.now(),
            );
            if (started.kind === 'conflict' || started.kind === 'rejected')
              throw new ProposalChangedError();
            if (started.kind === 'storage_error') throw new Error(started.detail);
            drafts.delete(id);
            return { workoutId: started.result.sessionId };
          }
          const prepared =
            draft.kind === 'compose'
              ? previewDayPlan(ctx, draft.intent, id)
              : { ...previewPlanChange(ctx, draft.intent, id), replaced: [] as string[] };
          if (JSON.stringify(prepared.summary) !== JSON.stringify(draft.summary))
            throw new ProposalChangedError();
          saveCoachWeekV2(id, prepared.constraints, prepared.sync, prepared.replaced, deps.now());
          drafts.delete(id);
          return {};
        });
      } finally {
        applying.delete(id);
      }
    },
  };
}
