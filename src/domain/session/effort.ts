/** P4b.5, 11 §7: observations suggest assessed choices; accepting a choice is a separate command. */
import { rankAlternatives } from './alternatives';
import { evaluateSessionChange } from './evaluate';
import { settledSets } from './revision';
import type {
  ActiveSessionState,
  FeelChange,
  FeelConsultation,
  FeelOption,
  SessionChangeEvaluation,
  SessionChangeSnapshot,
  SessionPlanChange,
} from './types';

export function assessFeel(
  snap: SessionChangeSnapshot,
  session: ActiveSessionState,
  change: FeelChange,
  observation: SessionChangeEvaluation,
): FeelConsultation {
  const options: FeelOption[] = [];
  const recommendedOptionIds: string[] = [];
  // A malformed plan or unknown exposure cannot supply safe recipes for any choice.
  if (
    observation.checks.some(
      (c) =>
        c.class === 'hard' &&
        c.status === 'fail' &&
        (c.code === 'PLAN_INVALID' ||
          c.code === 'PLAN_INTEGRITY' ||
          c.code === 'UNSUPPORTED_CAPABILITY'),
    )
  )
    return { options, recommendedOptionIds };
  const settled = settledSets(session);
  const exposures = session.plan.exposures.filter((e) =>
    change.exposureId === null
      ? e.sets.some((s) => !settled.has(s.id))
      : e.id === change.exposureId,
  );
  const add = (
    intent: Extract<SessionPlanChange, { exposureId: string }>,
    why: FeelOption['why'],
  ): FeelOption => {
    const option = {
      id: `${why}:${intent.exposureId}`,
      change: intent,
      why,
      assessment: evaluateSessionChange(snap, session, intent),
    };
    options.push(option);
    return option;
  };
  const later: FeelOption = {
    id: 'next_prescription',
    change: null,
    why: 'next_prescription',
    assessment: observation,
  };
  for (const e of exposures) {
    if (change.feel === 'too_easy') {
      const more = add({ kind: 'add_sets', exposureId: e.id, sets: 1 }, 'add_set');
      recommendedOptionIds.push(more.assessment.verdict === 'ok' ? more.id : later.id);
      continue;
    }
    const pending = e.sets.filter((s) => !settled.has(s.id));
    if (pending.length === 0) continue;
    const drop = add({ kind: 'reduce_remaining', exposureId: e.id, dropSets: 1 }, 'drop_set');
    const easier = add(
      { kind: 'reduce_remaining', exposureId: e.id, easier: true },
      'easier_resistance',
    );
    const skip = add({ kind: 'skip_remaining', exposureId: e.id }, 'skip_remaining');
    let preferred =
      new Set(pending.map((s) => s.logicalSetId)).size >= 2 && easier.assessment.patch !== null
        ? easier
        : drop;
    if (easier.assessment.patch === null) {
      const variants = rankAlternatives(
        { exerciseId: e.exercise.id, slotId: e.slotId ?? undefined, muscles: [] },
        {
          snap,
          session,
          change: { kind: 'swap_remaining', exposureId: e.id, exercise: { id: e.exercise.id } },
          variantDirection: 'easier',
        },
      );
      for (const v of variants)
        options.push({
          id: `variant_easier:${e.id}:${v.exerciseId}`,
          change: v.change,
          why: 'variant_easier',
          assessment: v.assessment,
        });
      if (variants.length > 0) preferred = options[options.length - variants.length]!;
    }
    if (preferred.assessment.patch === null) preferred = skip;
    if (preferred.assessment.patch !== null) recommendedOptionIds.push(preferred.id);
  }
  if (change.feel === 'too_easy') {
    options.push(later);
    if (exposures.length === 0) recommendedOptionIds.push(later.id);
  }
  return { options, recommendedOptionIds: [...new Set(recommendedOptionIds)] };
}
