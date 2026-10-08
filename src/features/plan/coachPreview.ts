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
  PLAN_DAY_REASONS,
  PLAN_SKIP_REASONS,
  TOOL_LIMITS,
  type ToolError,
  type ToolInput,
  type ToolOutput,
} from '@/ai/contract/chatTools';
import type { SessionPlan } from '@/domain/plan/types';
import { syncWeek } from '@/domain/plan/weekSync';
import { addDays } from '@/domain/time/trainingDate';
import type { PlanningSnapshot } from './planningSnapshot';

/** One day as the chat's plan tools describe it: choices and reasons, never a load. */
export function summarizePlan(
  s: PlanningSnapshot,
  date: string,
  plan: SessionPlan | null,
  status: ToolOutput<'getWeekPlan'>['days'][number]['status'] = 'planned',
  rest = plan === null,
): ToolOutput<'getWeekPlan'>['days'][number] {
  const ref = (id: string) => ({ id, name: s.source.catalog[id]?.name ?? id });
  const movement = (id: string) => s.input.slots.find((slot) => slot.id === id)?.name ?? id;
  return {
    date,
    status,
    rest,
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
      movement: movement(e.slotId),
    })),
    skipped: (plan?.skipped ?? [])
      .filter((e) => (PLAN_SKIP_REASONS as readonly string[]).includes(e.reason))
      .slice(0, TOOL_LIMITS.planSkippedShown)
      .map((e) => ({ movement: movement(e.slotId), reason: e.reason })),
  };
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
  const from = constraints.map((c) => c.from).sort()[0]!;
  const sync = syncWeek({
    ...s.input,
    constraints: [...(s.input.constraints ?? []), ...constraints],
    request: { trigger: 'coach', from },
  });
  const baseline = syncWeek(s.input);
  const changes: ToolOutput<'proposePlanChange'>['changes'] = [];
  for (const row of sync.rows) {
    const previous =
      s.input.stored.find((d) => d.date === row.date) ??
      baseline.rows.find((d) => d.date === row.date);
    const before = summarizePlan(s, row.date, previous?.forecast ?? null);
    const after = summarizePlan(s, row.date, row.forecast);
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ before, after });
  }
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

export function validatePlanIntent(
  input: ToolInput<'proposePlanChange'>,
  question: string,
): ToolError | null {
  if (gateUserText(question).kind !== 'pass' || gateUserText(input.note).kind !== 'pass')
    return { error: 'invalid_input' };
  if (checkReply(cleanText(input.note), { sparse: false }).length > 0)
    return { error: 'invalid_input' };
  // The note is a neutral request label, not another channel for a prescription.
  if (notePrescribes(input.note)) return { error: 'invalid_input' };
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
