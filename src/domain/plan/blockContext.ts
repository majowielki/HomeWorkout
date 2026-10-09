/**
 * What the block of the engine reads of the person's history (engine,
 * 03 §9, §16): how each slot's exercise has been doing, and the signals for a
 * reactive deload. One place for the app (which reads it from the database)
 * and the simulation (which makes it up), so the two cannot decide a block
 * differently.
 */

import { fatigueSignals } from '../autoregulation/signals';
import { buildHistoryIndex } from '../history';
import type { ExposureRecord } from '../observations/exposure';
import { isPerformed } from '../observations/qualify';
import type { TrainingPreferences } from '../preferences/preferences';
import { assess } from '../progression/assessed';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';
import { blockEvidence } from '../progression/stall';
import type { ModelContext } from '../resistance/registry';
import type { ResistanceSpec } from '../resistance/types';
import type { Exercise } from '../types';
import type { BlockContext } from './block';
import type { EligibilityContext } from './eligibility';
import { slotByExercise } from './eligibility';
import { modelFor, resistanceOf } from './resistanceOf';
import type { BlockState, DailyReadiness, Slot } from './types';

export interface BlockContextInputs {
  asOf: string;
  /** The open block, if there is one; read only when a block is closing. */
  block: BlockState | null;
  records: readonly ExposureRecord[];
  daily: readonly DailyReadiness[];
  slots: readonly Slot[];
  catalog: Readonly<Record<string, Exercise>>;
  eligibility: EligibilityContext;
  preferences: Pick<TrainingPreferences, 'exercises' | 'equipment' | 'variety' | 'muscleWeights'>;
  models: ModelContext;
  /** The selections of the blocks that have ended, newest first. */
  recentBlocks: readonly Readonly<Record<string, string>>[];
  /** The person asked for a deload today. */
  deloadRequested: boolean;
  chosen?: Readonly<Record<string, string>>;
}

export function blockContext(i: BlockContextInputs): BlockContext {
  const slotOf = slotByExercise(i.slots);
  const modelOf = (spec: ResistanceSpec) => modelFor(spec, i.models);
  const idx = buildHistoryIndex(i.records, i.catalog, {
    muscleWeights: i.preferences.muscleWeights,
  });
  const historyOf = (slot: Slot, id: string | undefined) => {
    const exercise = id === undefined ? undefined : i.catalog[id];
    const res = exercise === undefined ? null : resistanceOf(exercise, slot, i.models);
    return res === null ? null : { res, history: idx.byKey.get(res.comparisonKey) ?? [] };
  };
  const performed = i.records
    .filter((r) => r.sets.some(isPerformed))
    .map((r) => r.trainingDate)
    .sort();
  return {
    asOf: i.asOf,
    lastSessionDate: performed.at(-1) ?? null,
    slots: i.slots,
    catalog: i.catalog,
    eligibility: i.eligibility,
    preferences: i.preferences,
    chosen: i.chosen,
    recentBlocks: i.recentBlocks,
    evidence: (slot, id) => {
      const found = historyOf(slot, id);
      return found === null
        ? null
        : blockEvidence(
            assess(found.history, DEFAULT_PROGRESSION_POLICY, found.res.model),
            i.block!.startedOn,
            found.res.model,
            { introExposures: DEFAULT_PROGRESSION_POLICY.introExposures, window: 3 },
          );
    },
    deload: {
      signals: fatigueSignals({
        asOf: i.asOf,
        records: i.records,
        slotOf,
        daily: i.daily,
        modelOf,
      }),
      keyExercises: i.slots
        .filter((s) => s.kind === 'compound')
        .flatMap((s) => {
          const found = historyOf(s, i.block?.selections[s.id]);
          return found === null
            ? []
            : [
                {
                  history: assess(found.history, DEFAULT_PROGRESSION_POLICY, found.res.model),
                  model: found.res.model,
                },
              ];
        }),
      daily: i.daily,
      requested: i.deloadRequested,
    },
  };
}
