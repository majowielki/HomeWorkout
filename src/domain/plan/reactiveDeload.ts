/**
 * When a deload week starts (engine v2, 03 §16, 13 §17, D31). There is no
 * planned deload after 28 days: a block of 35 days is the unit of rotation, and
 * the deload comes when the body asks — two different overload signals, or a
 * stall of key lifts together with poor sleep or low energy — or when the person
 * asks. Not in the first week of a block, and once per block.
 */

import { AUTOREGULATION_CONFIG, DELOAD_V2_CONFIG } from '../config/training';
import type { Assessed } from '../progression/assessed';
import { stalledRun } from '../progression/stall';
import type { ResistanceModel } from '../resistance/types';
import { addDays, daysBetween } from '../time/trainingDate';
import type { FatigueSignal } from './reasons';
import type { BlockState, DailyReadiness } from './types';

export type DeloadReason = 'SIGNALS_2PLUS' | 'STALL_WITH_FATIGUE' | 'USER_REQUEST';

export interface DeloadInput {
  asOf: string;
  block: Pick<BlockState, 'startedOn' | 'deloadFrom'>;
  /** The overload signals of the day (`fatigueSignals`). */
  signals: readonly FatigueSignal[];
  /** The histories of the compound exercises of the block, each with the model of its resistance. */
  keyExercises: readonly { history: readonly Assessed[]; model: ResistanceModel }[];
  daily: readonly DailyReadiness[];
  /** The person asked for a deload. */
  requested: boolean;
  cfg?: typeof DELOAD_V2_CONFIG;
  signalCfg?: Pick<typeof AUTOREGULATION_CONFIG, 'reactiveDeloadSignals'>;
}

/** Sleep under the limit or low energy on any of the last days. */
function wornOut(daily: readonly DailyReadiness[], asOf: string, cfg: typeof DELOAD_V2_CONFIG) {
  const from = addDays(asOf, -(cfg.fatigueWindowDays - 1));
  return daily
    .filter((d) => d.date >= from && d.date <= asOf)
    .some(
      (d) =>
        (d.sleepHours !== null && d.sleepHours < cfg.lowSleepHours) ||
        (d.energy !== null && d.energy <= cfg.lowEnergy),
    );
}

export function reactiveDeloadTrigger(input: DeloadInput): {
  trigger: boolean;
  reasons: DeloadReason[];
} {
  const cfg = input.cfg ?? DELOAD_V2_CONFIG;
  const signalCfg = input.signalCfg ?? AUTOREGULATION_CONFIG;
  if (input.block.deloadFrom !== null) return { trigger: false, reasons: [] };

  const reasons: DeloadReason[] = [];
  if (input.requested) reasons.push('USER_REQUEST');
  // The body asks only once the block has run for a while.
  if (daysBetween(input.block.startedOn, input.asOf) >= cfg.minDaysIntoBlock) {
    if (new Set(input.signals).size >= signalCfg.reactiveDeloadSignals) {
      reasons.push('SIGNALS_2PLUS');
    }
    const stalled = input.keyExercises.filter(
      (k) => stalledRun(k.history, k.model) >= cfg.stallExposures,
    );
    if (stalled.length >= cfg.stallExercises && wornOut(input.daily, input.asOf, cfg)) {
      reasons.push('STALL_WITH_FATIGUE');
    }
  }
  return { trigger: reasons.length > 0, reasons };
}
