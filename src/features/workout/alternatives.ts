/**
 * Swapping the exercise on screen for another, through the engine: the alternatives it ranks
 * (each already assessed, with the prescription it would give) and the change that makes
 * one of them the rest of the exercise.
 */
import { randomUUID } from 'expo-crypto';

import { loadSessionChangeSource } from '@/db/repositories/sessionChangeSource';
import { applySessionChange } from '@/db/repositories/sessionChanges';
import { getCurrentBlock, setBlockSelection } from '@/db/repositories/trainingBlocks';
import type { EquipmentFamily } from '@/domain/catalog/attributes';
import type { CommandResult } from '@/domain/commands/result';
import type { PlannedExposure } from '@/domain/plan/planV2';
import { adviceToAcknowledge } from '@/domain/policy/hardAdvice';
import { rankAlternatives } from '@/domain/session/assess';
import type { RankedAlternative } from '@/domain/session/types';

export interface Alternatives {
  alternatives: RankedAlternative[];
  /** The revisions the ranking was made on: the swap is refused if the session moved on. */
  expected: { planRevision: number; historyRevision: number };
}

/** What the engine would put in place of an exercise of the running session; null when the session is not readable. */
export function loadAlternatives(
  sessionId: string,
  exposure: Pick<PlannedExposure, 'id' | 'slotId' | 'exercise'>,
  family?: EquipmentFamily,
): Alternatives | null {
  const source = loadSessionChangeSource(sessionId);
  if (source === null || source.problems.length > 0) return null;
  const { snap, session } = source;
  return {
    alternatives: rankAlternatives(
      {
        exerciseId: exposure.exercise.id,
        slotId: exposure.slotId ?? undefined,
        muscles: [],
      },
      {
        snap,
        session,
        change: {
          kind: 'swap_remaining',
          exposureId: exposure.id,
          exercise: { id: exposure.exercise.id },
        },
        equipmentFamily: family,
      },
    ),
    expected: { planRevision: session.plan.planRevision, historyRevision: snap.historyRevision },
  };
}

/** The advice a swap has to be accepted with: what the person is told before they choose it. */
export const adviceOf = (alternative: RankedAlternative) =>
  adviceToAcknowledge(alternative.assessment.checks);

/**
 * Makes the alternative the rest of the exercise. With `forBlock` the exercise also becomes the
 * block's choice for its slot, so the next sessions of the block follow it; `blockSaved` says
 * whether that worked.
 */
export async function swapExercise(
  sessionId: string,
  exposure: Pick<PlannedExposure, 'slotId'>,
  alternative: RankedAlternative,
  expected: Alternatives['expected'],
  options: { forBlock: boolean; channel: 'touch' | 'voice' },
): Promise<{ result: CommandResult<{ planRevision: number }>; blockSaved: boolean }> {
  const result = applySessionChange({
    commandId: randomUUID(),
    sessionId,
    patchId: alternative.patchId,
    change: alternative.change,
    expected,
    acknowledged: adviceOf(alternative),
    channel: options.channel,
  });
  if (result.kind !== 'committed' || !options.forBlock || exposure.slotId === null) {
    return { result, blockSaved: true };
  }
  try {
    const block = await getCurrentBlock();
    if (block) await setBlockSelection(block.id, exposure.slotId, alternative.exerciseId);
    return { result, blockSaved: true };
  } catch (error) {
    console.warn('could not save the swap for the block', error);
    return { result, blockSaved: false };
  }
}
