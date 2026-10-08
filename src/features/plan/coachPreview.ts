import { gateUserText } from '@/ai/chat/gate';
import { detectTextSignal } from '@/domain/coach/medicalSignal';
import { fold } from '@/domain/coach/text';
import { checkReply } from '@/domain/coach/outputGuards';
import { cleanText } from '@/ai/context/redact';
import {
  PLAN_DAY_REASONS,
  PLAN_SKIP_REASONS,
  type ToolError,
  type ToolInput,
  type ToolOutput,
} from '@/ai/contract/chatTools';
import type { SessionPlan } from '@/domain/plan/types';
import { syncWeek } from '@/domain/plan/weekSync';
import { addDays } from '@/domain/time/trainingDate';
import type { PlanningSnapshot } from './planningSnapshot';
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
    exercises: (plan?.exercises ?? []).map((e) => ({
      exercise: ref(e.exerciseId),
      sets: e.sets,
      perSide: s.source.catalog[e.exerciseId]?.sides === 'perSet',
      movement: movement(e.slotId),
    })),
    skipped: (plan?.skipped ?? [])
      .filter((e) => (PLAN_SKIP_REASONS as readonly string[]).includes(e.reason))
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
      reason: reason as 'doms' | 'busy' | 'other',
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
  // This is a neutral request label, not another channel for a prescription.
  if (
    /\bkg\b|kilogram|\brir\b|powtorzen|powtorz|\bseri[aei]\b|\bgum[aeiy]\b|hantl/.test(
      fold(input.note),
    )
  )
    return { error: 'invalid_input' };
  for (const c of input.constraints) {
    if (
      c.fromDaysAhead + c.days > 7 ||
      (c.kind === 'avoid_muscle' ? c.muscles.length === 0 : c.muscles.length !== 0)
    )
      return { error: 'invalid_input' };
    if (
      c.kind === 'avoid_muscle' &&
      (c.reason === 'doms' || detectTextSignal(question) === 'soreness')
    ) {
      if (
        c.reason !== 'doms' ||
        (c.domsLevel ?? 0) < 4 ||
        !/zakwas|doms/.test(fold(question)) ||
        /nie\s+(?:zakwas|doms)/.test(fold(question)) ||
        /lekk|lagod|[123]\s*\/\s*5|nie\s+(?:siln|mocn)/.test(fold(question)) ||
        !/siln|mocn|duze|[45]\s*\/\s*5/.test(fold(question))
      )
        return { error: 'clarification_required' };
    }
  }
  return null;
}

/** Extra work cannot bypass strong or unknown soreness reported in the question. */
export function validateExtraQuestion(question: string): ToolError | null {
  const gate = gateUserText(question);
  if (gate.kind !== 'pass') return { error: 'invalid_input' };
  const text = fold(gate.text);
  if (
    detectTextSignal(gate.text) === 'soreness' &&
    (/siln|mocn|duze|[45]\s*\/\s*5/.test(text) || !/lekk|lagod|[123]\s*\/\s*5/.test(text))
  )
    return { error: 'clarification_required' };
  return null;
}
