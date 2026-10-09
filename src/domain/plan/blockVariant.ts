/**
 * Which exercise a slot gets for the next block (engine, 03 §9, 12 §4.2).
 *
 * Today the next block takes the next exercise of the slot, whatever happened.
 * Here a variant that is still giving progress stays (`ROTATION_CONTINUITY`), and
 * one that has not been done enough to judge stays too
 * (`INSUFFICIENT_ROTATION_EVIDENCE`: no data is not a stall). Otherwise the
 * rotation moves on, and among variants so close that either would do the
 * person’s preference decides, never past a rule: what may not be planned is
 * not a candidate, and an exercise the person would rather avoid is still
 * chosen when nothing else is left.
 */

import { PREFERENCE_CONFIG, ROTATION_CONFIG } from '../config/training';
import {
  nearEquivalent,
  preferenceScore,
  type TrainingPreferences,
} from '../preferences/preferences';
import type { BlockEvidence } from '../progression/stall';
import type { Exercise } from '../types';
import { nextCandidate } from './blockSelection';
import { allowedCandidates, type EligibilityContext, slotByExercise } from './eligibility';
import type { Slot } from './types';

export type RotationPolicy = 'cycle_all' | 'progress_aware';

export type RotationReason =
  | 'ROTATION_CONTINUITY'
  | 'INSUFFICIENT_ROTATION_EVIDENCE'
  | 'USER_CHOICE'
  | 'PREFERRED'
  | 'AVOIDED_SKIPPED';

export interface VariantChoice {
  exerciseId: string | undefined;
  reasons: RotationReason[];
}

export interface VariantInput {
  slot: Slot;
  /** The variant of the block that is ending; undefined for the first block. */
  current: string | undefined;
  catalog: Readonly<Record<string, Exercise>>;
  eligibility: EligibilityContext;
  preferences: Pick<TrainingPreferences, 'exercises' | 'equipment' | 'variety'>;
  /** What `current` showed in the block that is ending; null if nothing is known. */
  evidence: BlockEvidence | null;
  /** The selections of earlier blocks, newest first: an avoided variant is skipped if another was not used lately. */
  recentBlocks: readonly Readonly<Record<string, string>>[];
  /** The person picked this one for the slot. */
  chosenByUser?: string;
  rotation?: typeof ROTATION_CONFIG;
  avoidedLookbackBlocks?: number;
}

/** The policy a person’s wish for variety stands for: "varied" is the plain rotation of today. */
export const rotationPolicyOf = (variety: TrainingPreferences['variety']): RotationPolicy =>
  variety === 'varied' ? 'cycle_all' : 'progress_aware';

export function chooseBlockVariant(input: VariantInput): VariantChoice {
  const { slot, current, catalog, eligibility } = input;
  const cfg = input.rotation ?? ROTATION_CONFIG;
  const allowed = allowedCandidates(slot, catalog, eligibility);
  if (allowed.length === 0) return { exerciseId: undefined, reasons: [] };
  const isAllowed = (id: string | undefined) => allowed.some((e) => e.id === id);

  if (input.chosenByUser !== undefined && isAllowed(input.chosenByUser)) {
    return { exerciseId: input.chosenByUser, reasons: ['USER_CHOICE'] };
  }

  // A variant that works, or has not been tried enough to say it does not, is kept (a forced change
  // — the variant is no longer allowed — never gets here).
  if (rotationPolicyOf(input.preferences.variety) === 'progress_aware' && isAllowed(current)) {
    if (input.evidence === null || input.evidence.qualifiedExposures < cfg.minQualifiedExposures) {
      return { exerciseId: current, reasons: ['INSUFFICIENT_ROTATION_EVIDENCE'] };
    }
    if (input.evidence.progressing)
      return { exerciseId: current, reasons: ['ROTATION_CONTINUITY'] };
  }

  const next = nextCandidate(slot, current, catalog, eligibility)!;
  const slotOf = slotByExercise([slot]);
  const nextExercise = catalog[next]!;
  const order = (id: string) => {
    const ids = slot.exerciseIds;
    const start = current === undefined ? -1 : ids.indexOf(current);
    return (ids.indexOf(id) - start + ids.length) % ids.length || ids.length;
  };
  const best = (pool: readonly Exercise[]) =>
    [...pool].sort(
      (a, b) =>
        preferenceScore(b, input.preferences) - preferenceScore(a, input.preferences) ||
        order(a.id) - order(b.id),
    )[0]!;

  // Among the variants so close to the next one that either would do, the person’s preference decides.
  const group = allowed.filter((e) => e.id === next || nearEquivalent(e, nextExercise, slotOf));
  let chosen = best(group);
  const reasons: RotationReason[] = chosen.id === next ? [] : ['PREFERRED'];

  // An avoided variant gives way to one that is not, if that one was not used in the last blocks.
  if (preferenceScore(chosen, input.preferences) < 0) {
    const lookback = input.avoidedLookbackBlocks ?? PREFERENCE_CONFIG.avoidedLookbackBlocks;
    const used = new Set(input.recentBlocks.slice(0, lookback).map((b) => b[slot.id]));
    const fresh = allowed.filter(
      (e) => preferenceScore(e, input.preferences) >= 0 && !used.has(e.id),
    );
    if (fresh.length > 0) {
      chosen = best(fresh);
      reasons.push('AVOIDED_SKIPPED');
    }
  }
  return { exerciseId: chosen.id, reasons };
}

/** The selections for a whole block: every slot asks `chooseBlockVariant`. */
export function chooseBlockSelections(
  slots: readonly Slot[],
  inputs: Omit<VariantInput, 'slot' | 'current' | 'evidence' | 'chosenByUser'>,
  previous: Readonly<Record<string, string>> | null,
  evidence: (slot: Slot, current: string | undefined) => BlockEvidence | null,
  chosen: Readonly<Record<string, string>> = {},
): { selections: Record<string, string>; reasons: Record<string, RotationReason[]> } {
  const selections: Record<string, string> = {};
  const reasons: Record<string, RotationReason[]> = {};
  for (const slot of slots) {
    const current = previous?.[slot.id];
    const pick = chooseBlockVariant({
      ...inputs,
      slot,
      current,
      evidence: evidence(slot, current),
      chosenByUser: chosen[slot.id],
    });
    if (pick.exerciseId !== undefined) selections[slot.id] = pick.exerciseId;
    reasons[slot.id] = pick.reasons;
  }
  return { selections, reasons };
}
