import { daysBetween } from '../time/trainingDate';

/** One measurement on a calendar day, 'YYYY-MM-DD'. */
export interface DatedValue {
  date: string;
  value: number;
}

export interface SmoothedPoint extends DatedValue {
  /** Mean of every value within the trailing window ending on this date, or null if that window holds fewer than `minPoints`. */
  average: number | null;
}

/**
 * Trailing moving average over a calendar window, aligned to the input
 * points. Missing days are simply absent from the window — no
 * interpolation, because a day without a weigh-in carries no information.
 *
 * Daily weight swings ±1.5 kg on water and glycogen; the 7-day average is
 * what the user should look at, and what every downstream decision uses.
 * See Documents/PLAN.md §7.4.
 */
export function movingAverage(
  points: readonly DatedValue[],
  windowDays = 7,
  minPoints = 3,
): SmoothedPoint[] {
  if (windowDays < 1) throw new RangeError(`windowDays must be >= 1, got ${windowDays}`);
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));

  return sorted.map((point, i) => {
    const inWindow: number[] = [];
    for (let j = i; j >= 0; j -= 1) {
      const candidate = sorted[j]!;
      if (daysBetween(candidate.date, point.date) >= windowDays) break;
      inWindow.push(candidate.value);
    }
    const average =
      inWindow.length >= minPoints
        ? inWindow.reduce((sum, v) => sum + v, 0) / inWindow.length
        : null;
    return { ...point, average };
  });
}

/**
 * Least-squares slope over the most recent `windowDays`, expressed per
 * week. Null when there are fewer than `minPoints` in the window — two
 * weeks of noise fitted with a line is worse than no number at all.
 */
export function weeklyTrend(
  points: readonly DatedValue[],
  windowDays = 21,
  minPoints = 10,
): number | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1]!;
  const window = sorted.filter((p) => daysBetween(p.date, last.date) < windowDays);
  if (window.length < minPoints) return null;

  const origin = window[0]!.date;
  const xs = window.map((p) => daysBetween(origin, p.date));
  const ys = window.map((p) => p.value);
  const n = xs.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (xs[i]! - meanX) * (ys[i]! - meanY);
    denominator += (xs[i]! - meanX) ** 2;
  }
  if (denominator === 0) return null; // every point on the same day
  return (numerator / denominator) * 7;
}

/** Round to one decimal — the UI never shows more precision than a bathroom scale has. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
