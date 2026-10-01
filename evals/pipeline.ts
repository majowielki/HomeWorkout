import { buildCoachContext } from '@/ai/context/buildCoachContext';
import { coachContextSchema, type CoachContext } from '@/ai/contract/coachContext';
import { scenario } from '@/ai/testing/synthetic';
import { addDays } from '@/domain/time/trainingDate';

import type { EvalCase } from './schema';

/**
 * The context a case puts in front of a model: the synthetic scenario run
 * through the real builder (so the real text gate applies), plus any notes
 * the case slips in *after* the gate to test the prompt's own guardrail.
 */
export function buildCaseContext(evalCase: EvalCase): CoachContext {
  const { context } = buildCoachContext(scenario(evalCase.scenario));
  const injected = (evalCase.injectNotes ?? []).map((note) => ({
    date: addDays(context.asOf, -note.daysAgo),
    source: note.source,
    text: note.text,
  }));
  return coachContextSchema.parse({ ...context, notes: [...context.notes, ...injected] });
}
