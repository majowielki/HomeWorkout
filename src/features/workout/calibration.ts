/**
 * The calibration of a new exercise inside the session (engine, 03 §13, D24): after a set of the
 * first exposure that came out far too easy or far too hard, the sets that remain are offered one step
 * up or down. Nothing is changed by itself: the person takes the offer with one touch, and not taking it
 * is not a failure. The change itself is the engine's own `reduce_remaining` (easier / harder), assessed
 * and checked again when it is applied.
 */
import type { ApplySessionChangeCommand } from '@/db/repositories/sessionChanges';
import { loadSessionChangeSource } from '@/db/repositories/sessionChangeSource';
import { adviceToAcknowledge } from '@/domain/policy/hardAdvice';
import { calibrationProposal } from '@/domain/progression/firstExposure';
import { DEFAULT_PROGRESSION_POLICY } from '@/domain/progression/policy';
import { modelFor } from '@/domain/plan/resistanceOf';
import { assessSessionChange } from '@/domain/session/assess';
import type { ResistanceSpec } from '@/domain/resistance/types';

/** What the person has already been through in this session, by comparison key of the exercise. */
export interface CalibrationMemory {
  stepsUp: number;
  stepsDown: number;
  /** The person said no: the exercise is not offered again in this session. */
  declined: boolean;
}

export type CalibrationMemories = Record<string, CalibrationMemory>;

export interface CalibrationOffer {
  direction: 'up' | 'down';
  comparisonKey: string;
  /** The set just done, which the offer follows. */
  plannedSetId: string;
  exerciseId: string;
  /** How many sets would change. */
  remaining: number;
  from: ResistanceSpec;
  to: ResistanceSpec;
  /** What applying it sends, apart from the command id. */
  command: Omit<ApplySessionChangeCommand, 'commandId'>;
}

export const NO_MEMORY: CalibrationMemory = { stepsUp: 0, stepsDown: 0, declined: false };

/** The offer after a set of the first exposure of an exercise, or null when there is none to make. */
export function readCalibrationOffer(
  sessionId: string,
  plannedSetId: string,
  memories: CalibrationMemories,
): CalibrationOffer | null {
  const source = loadSessionChangeSource(sessionId);
  if (source === null || source.problems.length > 0) return null;
  const { snap, session } = source;
  const exposure = session.plan.exposures.find((e) => e.sets.some((s) => s.id === plannedSetId));
  if (
    exposure === undefined ||
    exposure.progressionScope !== 'primary' ||
    exposure.trace.code !== 'FIRST_COMPARABLE_EXPOSURE'
  ) {
    return null;
  }
  const memory = memories[exposure.comparisonKey] ?? NO_MEMORY;
  if (memory.declined) return null;
  const record = session.records.find((r) => r.exposureId === exposure.id);
  const set = record?.sets.find((s) => s.planned.id === plannedSetId);
  const first = exposure.sets[0];
  const model = first === undefined ? null : modelFor(first.resistance);
  if (set === undefined || model === null) return null;
  const proposal = calibrationProposal({
    set,
    state: { stepsUp: memory.stepsUp, stepsDown: memory.stepsDown },
    model,
    policy: DEFAULT_PROGRESSION_POLICY,
    // A swap to an easier variant and a lower target are not offered here: they are the next session's.
    easierVariant: null,
  });
  if (proposal === null || (proposal.kind !== 'step_up' && proposal.kind !== 'step_down')) {
    return null;
  }
  const up = proposal.kind === 'step_up';
  const change = {
    kind: 'reduce_remaining' as const,
    exposureId: exposure.id,
    ...(up ? { harder: true } : { easier: true }),
    calibrate: true,
  };
  const assessment = assessSessionChange(snap, session, change, { maxAlternatives: 0 });
  if (assessment.patch === null || assessment.verdict === 'blocked') return null;
  // The engine advises against it: not offered. An offer is made only when the engine stands behind it.
  if (adviceToAcknowledge(assessment.checks).length > 0) return null;
  const pending = exposure.sets.filter(
    (s) => !record!.sets.some((r) => r.planned.id === s.id && r.disposition !== 'pending'),
  );
  if (pending.length === 0) return null;
  return {
    direction: up ? 'up' : 'down',
    comparisonKey: exposure.comparisonKey,
    plannedSetId,
    exerciseId: exposure.exercise.id,
    remaining: new Set(pending.map((s) => s.logicalSetId)).size,
    from: pending[0]!.resistance,
    to: proposal.to,
    command: {
      sessionId,
      patchId: assessment.patch.patchId,
      change,
      expected: { planRevision: session.plan.planRevision, historyRevision: snap.historyRevision },
      acknowledged: [],
      channel: 'touch',
    },
  };
}
