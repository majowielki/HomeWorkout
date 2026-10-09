/**
 * Overload signals from the exposures of the engine (SPEC §6.1, 03 §16).
 * The same three signals as `fatigueSignals`, read from what was actually done
 * (`ExposureRecord`) instead of the sessions of historical sessions:
 *
 * - FATIGUE_HIGH: a hard set to the limit (RIR 0) on a compound lift on each of
 *   the last two days that had one
 * - PERFORMANCE_DROP: an exercise that did fewer repetitions (seconds) at the
 *   same resistance in each of its last two exposures — a lighter resistance
 *   is not a drop, the engine itself asks for one after a break
 * - RECOVERY_LOW: poor sleep three days running, or one muscle sore for four
 *
 * Only recent work counts, so an old bad week does not haunt the plan.
 */

import { AUTOREGULATION_CONFIG } from '../config/training';
import { compareCodePoints } from '../fingerprint';
import { effortOf } from '../observations/effort';
import type { ExposureRecord } from '../observations/exposure';
import { isPerformed, referenceResistance, requiredSets } from '../observations/qualify';
import { logicalAmounts } from '../progression/assessed';
import type { FatigueSignal } from '../plan/reasons';
import type { DailyReadiness, Slot } from '../plan/types';
import { compareSpecs } from '../resistance/compare';
import type { ResistanceModel, ResistanceSpec } from '../resistance/types';
import { addDays } from '../time/trainingDate';
import { recoveryLow } from './fatigue';

export interface SignalsInput {
  asOf: string;
  records: readonly ExposureRecord[];
  /** The slot of each exercise, by the id of the exercise (`slotByExercise`). */
  slotOf: ReadonlyMap<string, Pick<Slot, 'kind'>>;
  daily: readonly DailyReadiness[];
  modelOf: (spec: ResistanceSpec) => ResistanceModel | null;
}

export function fatigueSignals(input: SignalsInput, cfg = AUTOREGULATION_CONFIG): FatigueSignal[] {
  const from = addDays(input.asOf, -(cfg.signalWindowDays - 1));
  const recent = input.records.filter(
    (r) => r.trainingDate >= from && r.trainingDate <= input.asOf,
  );
  const out: FatigueSignal[] = [];
  if (grindingCompounds(recent, input.slotOf)) out.push('FATIGUE_HIGH');
  if (performanceDrop(recent, input.modelOf)) out.push('PERFORMANCE_DROP');
  if (recoveryLow(input.daily, input.asOf, cfg)) out.push('RECOVERY_LOW');
  return out;
}

function grindingCompounds(
  recent: readonly ExposureRecord[],
  slotOf: SignalsInput['slotOf'],
): boolean {
  // Days, not sessions: an extra session the same day is not a second day of grinding.
  const days = new Map<string, boolean>();
  for (const rec of recent) {
    if (slotOf.get(rec.exerciseId)?.kind !== 'compound') continue;
    const hard = rec.sets.filter(
      (s) => isPerformed(s) && s.planned.role !== 'warmup' && s.planned.role !== 'mobility',
    );
    if (hard.length === 0) continue;
    const toTheLimit = hard.some((s) => effortOf(s.observation!) === 0);
    days.set(rec.trainingDate, (days.get(rec.trainingDate) ?? false) || toTheLimit);
  }
  const lastTwo = [...days.entries()].sort(([a], [b]) => compareCodePoints(a, b)).slice(-2);
  return lastTwo.length === 2 && lastTwo.every(([, limit]) => limit);
}

function performanceDrop(
  recent: readonly ExposureRecord[],
  modelOf: SignalsInput['modelOf'],
): boolean {
  const byKey = new Map<string, ExposureRecord[]>();
  for (const rec of recent) {
    if (rec.progressionScope !== 'primary') continue;
    byKey.set(rec.comparisonKey, [...(byKey.get(rec.comparisonKey) ?? []), rec]);
  }
  for (const list of byKey.values()) {
    const last3 = list
      .filter((r) => requiredSets(r).some(isPerformed))
      .sort((a, b) => compareCodePoints(a.trainingDate, b.trainingDate))
      .slice(-3);
    if (last3.length < 3) continue;
    const model = modelOf(requiredSets(last3[0]!)[0]!.planned.resistance);
    if (model === null) continue;
    const at = last3.map((r) => referenceResistance(r, model)!);
    if (!at.every((spec) => compareSpecs(spec, at[0]!, model) === 'equal')) continue;
    const best = last3.map((r) => Math.max(...logicalAmounts(r)));
    if (best[0]! > best[1]! && best[1]! > best[2]!) return true;
  }
  return false;
}
