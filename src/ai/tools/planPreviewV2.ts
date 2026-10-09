/**
 * What the chat's plan tools say about the week of engine v2 (contract 7): a day as choices and
 * reasons — never a load — the week as it stands, the week with a request added, the options for
 * composing a day, and the checks of the person's words before a request is made of them. Pure: the
 * phone reads the week and hands it over, a test builds it. Nothing here writes; a proposal is a
 * preview, and what is applied is applied by the controller in one transaction, against this same
 * preview made again.
 */
import { checkReply } from '../../domain/coach/outputGuards';
import {
  avoidNeedsClarification,
  notePrescribes,
  requestFits,
  sorenessBlocksExtraWork,
} from '../../domain/coach/intentGuards';
import { WEEK_CONFIG } from '../../domain/config/training';
import { type PlanConstraint } from '../../domain/plan/constraints';
import { planDayV2 } from '../../domain/plan/dayV2';
import type { SessionPlanV2 } from '../../domain/plan/planV2';
import {
  type DaySummaryV2,
  type SyncInputV2,
  type SyncResultV2,
  syncWeekV2,
} from '../../domain/plan/weekV2';
import { addDays } from '../../domain/time/trainingDate';
import { gateUserText } from '../chat/gate';
import { cleanText } from '../context/redact';
import { BIKE_REASONS, FATIGUE_SIGNALS } from '../../domain/plan/reasons';
import {
  COMPOSE_CONFLICTS,
  PLAN_DAY_REASONS,
  PLAN_REASON_CODES,
  PLAN_SKIP_REASONS,
  TOOL_LIMITS,
  type ToolError,
  type ToolInput,
  type ToolOutput,
} from '../contract/chatTools';

/** The week as it stands: everything it is planned from, and the days stored so far. */
export type WeekContext = Omit<SyncInputV2, 'request' | 'horizonDays'>;

type DaySummary = ToolOutput<'getWeekPlan'>['days'][number];

const inList = <T extends string>(list: readonly T[], code: string): code is T =>
  (list as readonly string[]).includes(code);

/** A slot's Polish name from the shipped data, which is what the chat calls a movement. */
export function movementName(ctx: Pick<WeekContext, 'slots'>, slotId: string): string {
  return ctx.slots.find((slot) => slot.id === slotId)?.name ?? slotId;
}

/** An exercise as the tools name it: by the catalogue, or by its id when the catalogue has lost it. */
const exerciseRef = (ctx: Pick<WeekContext, 'catalog'>, id: string) => ({
  id,
  name: ctx.catalog[id]?.name ?? id,
});

const logicalSets = (e: SessionPlanV2['exposures'][number]) =>
  new Set(e.sets.map((s) => s.logicalSetId)).size;

/** One day as the chat's plan tools describe it. */
export function summarizeDay(
  ctx: Pick<WeekContext, 'slots' | 'catalog'>,
  date: string,
  day: { forecast: SessionPlanV2 | null; summary?: DaySummaryV2 | null } | null,
  status: DaySummary['status'] = 'planned',
  rest: boolean = day?.forecast == null,
  composed: boolean = day?.summary?.composed ?? false,
): DaySummary {
  const plan = day?.forecast ?? null;
  const summary = day?.summary ?? null;
  const ref = (id: string) => exerciseRef(ctx, id);
  return {
    date,
    status,
    rest,
    composed,
    regions: summary?.regions ?? [],
    phase: summary?.phase ?? null,
    estimatedMinutes: summary?.estimatedMinutes ?? 0,
    dayReasons: (summary?.dayReasons ?? []).filter((r) =>
      inList(PLAN_DAY_REASONS, r),
    ) as DaySummary['dayReasons'],
    exercises: (plan?.exposures ?? []).slice(0, TOOL_LIMITS.planExercisesShown).map((e) => ({
      exercise: ref(e.exercise.id),
      sets: logicalSets(e),
      perSide: ctx.catalog[e.exercise.id]?.sides === 'perSet',
      movement: e.slotId === null ? ref(e.exercise.id).name : movementName(ctx, e.slotId),
    })),
    skipped: (summary?.skipped ?? [])
      .filter((e) => inList(PLAN_SKIP_REASONS, e.reason))
      .slice(0, TOOL_LIMITS.planSkippedShown)
      .map((e) => ({
        movement: movementName(ctx, e.slotId),
        reason: e.reason as DaySummary['skipped'][number]['reason'],
      })),
  };
}

/** The coming seven days, today's from the workout under way when there is one. */
export function describeWeek(
  ctx: WeekContext,
  live: { plan: SessionPlanV2 } | null,
): ToolOutput<'getWeekPlan'> {
  const sync = syncWeekV2({ ...ctx, running: live?.plan ?? ctx.running ?? null });
  return {
    asOf: ctx.asOf,
    days: Array.from({ length: TOOL_LIMITS.planDays }, (_, i) => {
      const date = addDays(ctx.asOf, i);
      const row =
        sync.rows.find((d) => d.date === date) ?? ctx.stored.find((d) => d.date === date) ?? null;
      const running = date === ctx.asOf && live !== null;
      const status: DaySummary['status'] = running
        ? 'in_progress'
        : ctx.trainedDates.has(date)
          ? 'done'
          : 'planned';
      return summarizeDay(
        ctx,
        date,
        running ? { forecast: live.plan, summary: row?.summary ?? null } : row,
        status,
        status === 'planned' && row?.forecast == null,
      );
    }),
  };
}

/** The week planned again with requests added (and some replaced): the days that differ. */
function previewWithRequests(
  ctx: WeekContext,
  added: readonly PlanConstraint[],
  replaced: ReadonlySet<string> = new Set(),
) {
  const constraints = [...(ctx.constraints ?? []).filter((c) => !replaced.has(c.id)), ...added];
  const from = added.map((c) => c.from).sort()[0]!;
  const sync = syncWeekV2({ ...ctx, constraints, request: { trigger: 'coach', from } });
  const baseline = syncWeekV2(ctx);
  const changes: ToolOutput<'proposePlanChange'>['changes'] = [];
  for (const day of sync.week.days) {
    // The baseline starts where the request does, so it has every day the preview has.
    const previous =
      ctx.stored.find((d) => d.date === day.date) ??
      baseline.rows.find((d) => d.date === day.date)!;
    const before = summarizeDay(ctx, day.date, previous);
    const after = summarizeDay(
      ctx,
      day.date,
      { forecast: day.forecast, summary: day.summary },
      'planned',
      day.rest,
      day.composed,
    );
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ before, after });
  }
  return { sync, changes };
}

export interface PlanChangePreview {
  constraints: PlanConstraint[];
  sync: SyncResultV2;
  summary: ToolOutput<'proposePlanChange'>;
}

export function previewPlanChange(
  ctx: WeekContext,
  intent: ToolInput<'proposePlanChange'>,
  id: string,
): PlanChangePreview {
  const constraints: PlanConstraint[] = intent.constraints.map((c, i) => ({
    id: `${id}-${i}`,
    kind: c.kind,
    muscles: [...new Set(c.muscles)],
    from: addDays(ctx.asOf, c.fromDaysAhead),
    until: addDays(ctx.asOf, c.fromDaysAhead + c.days - 1),
    reason: c.reason,
    source: 'coach',
    note: intent.note,
  }));
  const { sync, changes } = previewWithRequests(ctx, constraints);
  return {
    constraints,
    sync,
    summary: {
      proposalId: id,
      kind: 'plan',
      requiresAcceptance: true,
      constraints: intent.constraints.map((c, i) => ({
        kind: c.kind,
        muscles: constraints[i]!.muscles,
        from: constraints[i]!.from,
        until: constraints[i]!.until,
        reason: c.reason,
      })),
      changes,
    },
  };
}

export interface DayPlanPreview {
  /** The compose_day requests to store, one per day. */
  constraints: PlanConstraint[];
  /** Earlier compositions of the same days, taken back when this one is applied. */
  replaced: string[];
  sync: SyncResultV2;
  summary: ToolOutput<'proposeDayPlan'>;
}

/**
 * Days composed with the coach, through the engine (ADR 0006): each day's movements become a
 * compose_day request, the week is planned again with them, and every movement the engine did not
 * take comes back with its reason. `proposalId` is null when it took nothing.
 */
export function previewDayPlan(
  ctx: WeekContext,
  intent: ToolInput<'proposeDayPlan'>,
  id: string,
): DayPlanPreview {
  const days = intent.days.map((d) => ({ date: addDays(ctx.asOf, d.daysAhead), slots: d.slots }));
  const dates = new Set(days.map((d) => d.date));
  const replaced = (ctx.constraints ?? [])
    .filter((c) => c.kind === 'compose_day' && dates.has(c.from))
    .map((c) => c.id);
  const constraints: PlanConstraint[] = days.map((d, i) => ({
    id: `${id}-${i}`,
    kind: 'compose_day',
    muscles: [],
    from: d.date,
    until: d.date,
    reason: 'other',
    source: 'coach',
    note: intent.note,
    items: d.slots.map((slot) => ({
      slotId: slot.slotId,
      sets: slot.sets ?? TOOL_LIMITS.composedSets,
    })),
  }));
  const { sync, changes } = previewWithRequests(ctx, constraints, new Set(replaced));
  const summaryDays = days.map(({ date, slots }) => {
    const day = sync.week.days.find((w) => w.date === date)!;
    const conflicts = day.rest
      ? slots.map((slot) => ({
          movement: movementName(ctx, slot.slotId),
          reason: 'REST_DAY' as const,
        }))
      : day.violations.flatMap((v) => [
          {
            movement: movementName(ctx, v.slotId),
            reason: v.reason as (typeof COMPOSE_CONFLICTS)[number],
          },
        ]);
    return { date, applied: day.composed && day.selection!.length > 0, conflicts };
  });
  const applied = summaryDays.some((d) => d.applied);
  return {
    constraints: constraints.filter((_, i) => summaryDays[i]!.applied),
    replaced,
    sync,
    summary: {
      proposalId: applied ? id : null,
      kind: 'compose',
      requiresAcceptance: true,
      days: summaryDays,
      changes,
    },
  };
}

/**
 * getDayOptions: for each working movement, whether the engine could train it that day (the day
 * planned for that movement alone), why not, and the sets it would give. A day already trained is closed.
 */
export function describeDayOptions(
  ctx: WeekContext,
  daysAhead: number,
): ToolOutput<'getDayOptions'> | ToolError {
  const date = addDays(ctx.asOf, daysAhead);
  const sync = syncWeekV2(ctx);
  const day = sync.week.days.find((d) => d.date === date);
  if (!day) return { error: 'day_done' };
  const options = ctx.slots
    .filter((slot) => slot.kind !== 'filler')
    .slice(0, TOOL_LIMITS.dayOptionsShown)
    .map((slot) => {
      const out = day.rest
        ? null
        : planDayV2({
            asOf: date,
            intent: 'compose',
            catalog: ctx.catalog,
            slots: ctx.slots,
            eligibility: ctx.eligibility,
            block: day.block,
            records: ctx.records,
            rides: ctx.rides,
            daily: ctx.daily,
            constraints: ctx.constraints,
            week: ctx.week,
            preferences: ctx.preferences,
            models: ctx.models,
            answers: ctx.answers,
            only: [{ slotId: slot.id, sets: TOOL_LIMITS.composedSets }],
            session: {
              sessionId: `options-${date}`,
              planRevision: 1,
              kind: 'main',
              versions: ctx.versions,
              snapshotFingerprint: ctx.snapshotFingerprint,
              inputFingerprint: ctx.snapshotFingerprint,
            },
          });
      const chosen = out?.selection.find((s) => s.slotId === slot.id);
      const skip = out?.skipped.find((s) => s.slotId === slot.id);
      const exerciseId =
        chosen?.exerciseId ?? skip?.exerciseId ?? day.block.selections[slot.id] ?? null;
      return {
        slotId: slot.id,
        movement: slot.name,
        exercise: exerciseId === null ? null : exerciseRef(ctx, exerciseId),
        available: chosen !== undefined,
        reason: (chosen !== undefined
          ? null
          : (skip?.reason ?? null)) as ToolOutput<'getDayOptions'>['options'][number]['reason'],
        sets: chosen?.sets ?? 0,
      };
    });
  return {
    date,
    rest: day.rest,
    phase: day.summary?.phase ?? null,
    options,
    plan: summarizeDay(
      ctx,
      date,
      { forecast: day.forecast, summary: day.summary },
      'planned',
      day.rest,
      day.composed,
    ),
  };
}

// ----------------------------------------------------------------------- the person's words

/** The note and the question are checked as for any request; the movements must exist. */
function validateNote(note: string, question: string): ToolError | null {
  if (gateUserText(question).kind !== 'pass' || gateUserText(note).kind !== 'pass')
    return { error: 'invalid_input' };
  if (checkReply(cleanText(note), { sparse: false }).length > 0) return { error: 'invalid_input' };
  // The note is a neutral request label, not another channel for a prescription.
  if (notePrescribes(note)) return { error: 'invalid_input' };
  return null;
}

export function validatePlanIntent(
  input: ToolInput<'proposePlanChange'>,
  question: string,
): ToolError | null {
  const noteError = validateNote(input.note, question);
  if (noteError) return noteError;
  for (const c of input.constraints) {
    if (!requestFits(c, WEEK_CONFIG.horizonDays)) return { error: 'invalid_input' };
    if (avoidNeedsClarification(c, question)) return { error: 'clarification_required' };
  }
  return null;
}

export function validateComposeIntent(
  input: ToolInput<'proposeDayPlan'>,
  question: string,
  slots: WeekContext['slots'],
): ToolError | null {
  const noteError = validateNote(input.note, question);
  if (noteError) return noteError;
  const working = new Set(slots.filter((x) => x.kind !== 'filler').map((x) => x.id));
  const ahead = input.days.map((d) => d.daysAhead);
  if (new Set(ahead).size !== ahead.length) return { error: 'invalid_input' };
  if (input.days.some((d) => d.slots.some((slot) => !working.has(slot.slotId))))
    return { error: 'invalid_input' };
  // Soreness said in the chat is not in the log: ask, or record it first (E5).
  if (sorenessBlocksExtraWork(cleanText(question))) return { error: 'clarification_required' };
  return null;
}

/** Extra work cannot bypass strong or unknown soreness reported in the question. */
export function validateExtraQuestion(question: string): ToolError | null {
  const gate = gateUserText(question);
  if (gate.kind !== 'pass') return { error: 'invalid_input' };
  if (sorenessBlocksExtraWork(gate.text)) return { error: 'clarification_required' };
  return null;
}

/** proposeDayPlan on a week: checked, then previewed; the caller keeps the draft. */
export function proposeDayPreview(
  ctx: WeekContext,
  intent: ToolInput<'proposeDayPlan'>,
  question: string,
  id: string,
): { error: ToolError } | { intent: ToolInput<'proposeDayPlan'>; preview: DayPlanPreview } {
  const invalid = validateComposeIntent(intent, question, ctx.slots);
  if (invalid) return { error: invalid };
  const cleaned = { ...intent, note: cleanText(intent.note) };
  // Today is closed once trained: the week then starts tomorrow.
  const first = syncWeekV2(ctx).from;
  if (cleaned.days.some((d) => addDays(ctx.asOf, d.daysAhead) < first))
    return { error: { error: 'day_done' } };
  return { intent: cleaned, preview: previewDayPlan(ctx, cleaned, id) };
}

/**
 * getPlanExplanation: the plan of a day and why it is what it is, from the reason codes the engine
 * left. A session that has started is the plan as it was frozen; today before that is the week's
 * plan for today; a day past without a session has none. The reasons of the day itself come from
 * what was stored with it, so a frozen session of a day with no stored summary explains only its
 * exercises.
 */
export function describePlan(
  ctx: WeekContext,
  daysAgo: number,
  frozen: SessionPlanV2 | null,
): ToolOutput<'getPlanExplanation'> | ToolError {
  const date = addDays(ctx.asOf, -daysAgo);
  const row =
    ctx.stored.find((d) => d.date === date) ??
    (daysAgo === 0 ? syncWeekV2(ctx).rows.find((d) => d.date === date) : undefined);
  const plan = frozen ?? row?.forecast ?? null;
  if (plan === null) return { error: 'no_plan' };
  const summary = row?.summary ?? null;
  const reasonsOf = (e: SessionPlanV2['exposures'][number]) => {
    const recorded = Array.isArray(e.trace.evidence.codes)
      ? (e.trace.evidence.codes as unknown[])
      : [];
    return [...new Set([e.trace.code, ...recorded])].filter(
      (code): code is (typeof PLAN_REASON_CODES)[number] =>
        typeof code === 'string' && inList(PLAN_REASON_CODES, code),
    );
  };
  return {
    date,
    source: frozen === null ? 'today' : 'session',
    blockIndex: summary?.blockIndex ?? ctx.block?.index ?? 1,
    phase: summary?.phase ?? 'work',
    dayReasons: (summary?.dayReasons ?? []).filter((r) =>
      inList(PLAN_DAY_REASONS, r),
    ) as ToolOutput<'getPlanExplanation'>['dayReasons'],
    signals: (summary?.signals ?? []).filter((r) =>
      inList(FATIGUE_SIGNALS, r),
    ) as ToolOutput<'getPlanExplanation'>['signals'],
    bike: {
      minutes: summary?.bike?.minutes ?? 0,
      reasons: (summary?.bike?.reasons ?? []).filter((r) =>
        inList(BIKE_REASONS, r),
      ) as ToolOutput<'getPlanExplanation'>['bike']['reasons'],
    },
    exercises: plan.exposures.slice(0, TOOL_LIMITS.planExercisesShown).map((e) => ({
      exercise: exerciseRef(ctx, e.exercise.id),
      movement:
        e.slotId === null ? exerciseRef(ctx, e.exercise.id).name : movementName(ctx, e.slotId),
      sets: logicalSets(e),
      reasons: reasonsOf(e),
    })),
    skipped: (summary?.skipped ?? [])
      .filter((e) => inList(PLAN_SKIP_REASONS, e.reason))
      .slice(0, TOOL_LIMITS.planSkippedShown)
      .map((e) => ({
        movement: movementName(ctx, e.slotId),
        exercise: e.exerciseId === null ? null : exerciseRef(ctx, e.exerciseId),
        reason: e.reason as ToolOutput<'getPlanExplanation'>['skipped'][number]['reason'],
      })),
  };
}
