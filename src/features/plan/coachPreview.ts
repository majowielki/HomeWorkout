import { gateUserText } from '@/ai/chat/gate';
import {
  avoidNeedsClarification,
  notePrescribes,
  requestFits,
  sorenessBlocksExtraWork,
} from '@/domain/coach/intentGuards';
import { WEEK_CONFIG } from '@/domain/config/training';
import { checkReply } from '@/domain/coach/outputGuards';
import { cleanText } from '@/ai/context/redact';
import {
  COMPOSE_CONFLICTS,
  PLAN_DAY_REASONS,
  PLAN_SKIP_REASONS,
  TOOL_LIMITS,
  type ToolError,
  type ToolInput,
  type ToolOutput,
} from '@/ai/contract/chatTools';
import { composedOn, type PlanConstraint } from '@/domain/plan/constraints';
import type { SessionPlan } from '@/domain/plan/types';
import { type SyncResult, syncWeek } from '@/domain/plan/weekSync';
import { addDays } from '@/domain/time/trainingDate';
import type { PlanningSnapshot } from './planningSnapshot';

type DaySummary = ToolOutput<'getWeekPlan'>['days'][number];

/** One day as the chat's plan tools describe it: choices and reasons, never a load. */
export function summarizePlan(
  s: PlanningSnapshot,
  date: string,
  plan: SessionPlan | null,
  status: DaySummary['status'] = 'planned',
  rest = plan === null,
  composed = composedOn(s.input.constraints ?? [], date) !== null,
): DaySummary {
  const ref = (id: string) => ({ id, name: s.source.catalog[id]?.name ?? id });
  return {
    date,
    status,
    rest,
    composed,
    regions: plan?.regions ?? [],
    phase: plan?.phase ?? null,
    estimatedMinutes: plan?.estimatedMinutes ?? 0,
    dayReasons: (plan?.dayReasons ?? []).filter((r) =>
      (PLAN_DAY_REASONS as readonly string[]).includes(r),
    ),
    exercises: (plan?.exercises ?? []).slice(0, TOOL_LIMITS.planExercisesShown).map((e) => ({
      exercise: ref(e.exerciseId),
      sets: e.sets,
      perSide: s.source.catalog[e.exerciseId]?.sides === 'perSet',
      movement: movementName(s, e.slotId),
    })),
    skipped: (plan?.skipped ?? [])
      .filter((e) => (PLAN_SKIP_REASONS as readonly string[]).includes(e.reason))
      .slice(0, TOOL_LIMITS.planSkippedShown)
      .map((e) => ({ movement: movementName(s, e.slotId), reason: e.reason })),
  };
}

/** A slot's Polish name from the shipped data, which is what the chat calls a movement. */
export function movementName(s: PlanningSnapshot, slotId: string): string {
  return s.input.slots.find((slot) => slot.id === slotId)?.name ?? slotId;
}

/** The week planned again with requests added (and some replaced): the days that differ. */
function previewWithRequests(
  s: PlanningSnapshot,
  added: readonly PlanConstraint[],
  replaced: ReadonlySet<string> = new Set(),
) {
  const constraints = [...(s.input.constraints ?? []).filter((c) => !replaced.has(c.id)), ...added];
  const from = added.map((c) => c.from).sort()[0]!;
  const sync = syncWeek({ ...s.input, constraints, request: { trigger: 'coach', from } });
  const baseline = syncWeek(s.input);
  const changes: ToolOutput<'proposePlanChange'>['changes'] = [];
  for (const day of sync.week.days) {
    const previous =
      s.input.stored.find((d) => d.date === day.date) ??
      baseline.rows.find((d) => d.date === day.date);
    const before = summarizePlan(s, day.date, previous?.forecast ?? null);
    const after = summarizePlan(s, day.date, day.forecast, 'planned', day.rest, day.composed);
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ before, after });
  }
  return { sync, changes };
}

export function previewPlanChange(
  s: PlanningSnapshot,
  intent: ToolInput<'proposePlanChange'>,
  id: string,
) {
  const constraints = intent.constraints.map((c, i) => ({
    id: `${id}-${i}`,
    kind: c.kind,
    muscles: [...new Set(c.muscles)],
    from: addDays(s.input.asOf, c.fromDaysAhead),
    until: addDays(s.input.asOf, c.fromDaysAhead + c.days - 1),
    reason: c.reason,
    source: 'coach' as const,
    note: intent.note,
  }));
  const { sync, changes } = previewWithRequests(s, constraints);
  const summary: ToolOutput<'proposePlanChange'> = {
    proposalId: id,
    kind: 'plan',
    requiresAcceptance: true,
    constraints: constraints.map(({ kind, muscles, from, until, reason }) => ({
      kind,
      muscles,
      from,
      until,
      reason,
    })),
    changes,
  };
  return { constraints, sync, summary };
}

export interface DayPlanPreview {
  /** The compose_day requests to store, one per day. */
  constraints: PlanConstraint[];
  /** Earlier compositions of the same days, taken back when this one is applied. */
  replaced: string[];
  sync: SyncResult;
  summary: ToolOutput<'proposeDayPlan'>;
}

/**
 * Days composed with the coach, through the engine (ADR 0006): each day's
 * movements become a compose_day request, the week is planned again with
 * them, and every movement the engine did not take comes back with its
 * reason. `proposalId` is null when it took nothing.
 */
export function previewDayPlan(
  s: PlanningSnapshot,
  intent: ToolInput<'proposeDayPlan'>,
  id: string,
): DayPlanPreview {
  const days = intent.days.map((d) => ({
    date: addDays(s.input.asOf, d.daysAhead),
    slots: d.slots,
  }));
  const dates = new Set(days.map((d) => d.date));
  const replaced = (s.input.constraints ?? [])
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
  const { sync, changes } = previewWithRequests(s, constraints, new Set(replaced));
  const isConflict = (code: string): code is (typeof COMPOSE_CONFLICTS)[number] =>
    (COMPOSE_CONFLICTS as readonly string[]).includes(code);
  const summaryDays = days.map(({ date, slots }) => {
    const day = sync.week.days.find((w) => w.date === date)!;
    const conflicts = day.rest
      ? slots.map((slot) => ({
          movement: movementName(s, slot.slotId),
          reason: 'REST_DAY' as const,
        }))
      : day.violations.flatMap((v) =>
          v.slotId !== null && isConflict(v.code)
            ? [{ movement: movementName(s, v.slotId), reason: v.code }]
            : [],
        );
    return { date, applied: day.composed, conflicts };
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

/** The note and the question are checked as for any request; the movements must exist. */
export function validateComposeIntent(
  input: ToolInput<'proposeDayPlan'>,
  question: string,
  s: PlanningSnapshot,
): ToolError | null {
  const noteError = validateNote(input.note, question);
  if (noteError) return noteError;
  const working = new Set(s.input.slots.filter((x) => x.kind !== 'filler').map((x) => x.id));
  const ahead = input.days.map((d) => d.daysAhead);
  if (new Set(ahead).size !== ahead.length) return { error: 'invalid_input' };
  if (input.days.some((d) => d.slots.some((slot) => !working.has(slot.slotId))))
    return { error: 'invalid_input' };
  // Soreness said in the chat is not in the log: ask, or record it first (E5).
  if (sorenessBlocksExtraWork(cleanText(question))) return { error: 'clarification_required' };
  return null;
}

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

/** Extra work cannot bypass strong or unknown soreness reported in the question. */
export function validateExtraQuestion(question: string): ToolError | null {
  const gate = gateUserText(question);
  if (gate.kind !== 'pass') return { error: 'invalid_input' };
  if (sorenessBlocksExtraWork(gate.text)) return { error: 'clarification_required' };
  return null;
}

/** getDayOptions on a snapshot: the engine's options for one day, as the tool returns them. */
export function describeDayOptions(
  s: PlanningSnapshot,
  daysAhead: number,
): ToolOutput<'getDayOptions'> | ToolError {
  const date = addDays(s.input.asOf, daysAhead);
  const day = syncWeek({ ...s.input, optionsFor: date }).week.days.find((d) => d.date === date);
  if (!day) return { error: 'day_done' };
  return {
    date,
    rest: day.rest,
    phase: day.forecast?.phase ?? null,
    options: (day.options ?? []).slice(0, TOOL_LIMITS.dayOptionsShown).map((o) => ({
      slotId: o.slotId,
      movement: movementName(s, o.slotId),
      exercise:
        o.exerciseId === null
          ? null
          : { id: o.exerciseId, name: s.source.catalog[o.exerciseId]?.name ?? o.exerciseId },
      available: o.available,
      reason: o.reason,
      sets: o.sets,
    })),
    plan: summarizePlan(s, date, day.forecast, 'planned', day.rest, day.composed),
  };
}

/** proposeDayPlan on a snapshot: checked, then previewed; the caller keeps the draft. */
export function proposeDayPreview(
  s: PlanningSnapshot,
  intent: ToolInput<'proposeDayPlan'>,
  question: string,
  id: string,
): { error: ToolError } | { intent: ToolInput<'proposeDayPlan'>; preview: DayPlanPreview } {
  const invalid = validateComposeIntent(intent, question, s);
  if (invalid) return { error: invalid };
  const cleaned = { ...intent, note: cleanText(intent.note) };
  // Today is closed once trained: the week then starts tomorrow.
  const first = syncWeek(s.input).from;
  if (cleaned.days.some((d) => addDays(s.input.asOf, d.daysAhead) < first))
    return { error: { error: 'day_done' } };
  return { intent: cleaned, preview: previewDayPlan(s, cleaned, id) };
}
