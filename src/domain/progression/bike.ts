import { BIKE_CONFIG } from '../config/training';
import type { BikeReason } from '../plan/reasons';
import type { LayoffState } from './layoff';

/** One logged ride, warm-up or standalone. */
export interface Ride {
  date: string;
  minutes: number;
  /** This bike's own dial; null when not logged. */
  resistance: number | null;
  rpe: number | null;
}

export interface BikePrescription {
  minutes: number;
  /** Null: no resistance logged yet, the person picks one. */
  resistance: number | null;
  reasons: BikeReason[];
}

/**
 * The daily ride, SPEC §7 v1.2: time first, then resistance, steered by
 * how hard the last ride felt. No watts and no cadence rules — this bike
 * measures neither reliably. `rides` are oldest first.
 */
export function bikePrescription(
  rides: readonly Ride[],
  layoff: LayoffState,
  cfg = BIKE_CONFIG,
): BikePrescription {
  const { min, max } = cfg.minutes;
  const last = rides[rides.length - 1];
  if (!last) return { minutes: min, resistance: null, reasons: ['FIRST_EXPOSURE'] };

  if (layoff.tier === 'medium' || layoff.tier === 'long') {
    return {
      minutes: min,
      resistance: last.resistance,
      reasons: [layoff.tier === 'long' ? 'LAYOFF_LONG' : 'LAYOFF_MEDIUM'],
    };
  }

  const clamp = (m: number) => Math.min(max, Math.max(min, m));
  const hold: BikePrescription = {
    minutes: clamp(last.minutes),
    resistance: last.resistance,
    reasons: ['BIKE_HOLD'],
  };
  if (last.rpe === null) return hold;

  if (last.rpe >= cfg.hardRpe) {
    return {
      minutes: clamp(last.minutes - cfg.stepMinutes),
      resistance: last.resistance,
      reasons: ['BIKE_EASE_OFF'],
    };
  }

  if (last.rpe > cfg.easyRpe) return hold;

  if (last.minutes < max) {
    return {
      minutes: clamp(last.minutes + cfg.stepMinutes),
      resistance: last.resistance,
      reasons: ['BIKE_TIME_UP'],
    };
  }

  const previous = rides[rides.length - 2];
  const easyTwice = previous?.rpe != null && previous.rpe <= cfg.easyRpe;
  if (easyTwice && last.resistance !== null && last.resistance < cfg.resistanceMax) {
    return { minutes: max, resistance: last.resistance + 1, reasons: ['BIKE_RESISTANCE_UP'] };
  }
  return hold;
}
