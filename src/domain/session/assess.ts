/** Public consultation: one requested change plus at most three independently assessed alternatives. */
import { slotByExercise } from '../plan/eligibility';
import { rankAlternatives } from './alternatives';
import { evaluateSessionChange } from './evaluate';
import type {
  ActiveSessionState,
  AssessmentContext,
  ChangeAssessment,
  SessionChange,
  SessionChangeSnapshot,
} from './types';

export { rankAlternatives } from './alternatives';

export function assessSessionChange(
  snap: SessionChangeSnapshot,
  session: ActiveSessionState,
  change: SessionChange,
  opts: Pick<AssessmentContext, 'maxAlternatives' | 'equipmentFamily'> = {},
): ChangeAssessment {
  const assessment = evaluateSessionChange(snap, session, change);
  if (!('exercise' in change) || assessment.resolved.kind === 'ambiguous')
    return { ...assessment, alternatives: [] };
  const resolved = assessment.resolved;
  const exerciseId = resolved.kind === 'exercise' ? resolved.exerciseId : undefined;
  const exercise = exerciseId === undefined ? undefined : snap.catalog[exerciseId];
  const slotId =
    exerciseId === undefined ? undefined : slotByExercise(snap.slots).get(exerciseId)?.id;
  const muscles =
    exercise?.primaryMuscles ??
    (resolved.kind === 'not_found' ? (resolved.movement?.muscles ?? []) : []);
  return {
    ...assessment,
    alternatives: rankAlternatives(
      { exerciseId, slotId, muscles },
      { snap, session, change, ...opts },
    ),
  };
}
