/**
 * US Navy circumference method for body-fat percentage.
 *
 * Absolute accuracy is ±3–4 percentage points, which is why the plan says
 * to watch the trend, not the number (Documents/PLAN.md §6). Its value
 * here is that it needs nothing but a tape measure and is repeatable if
 * the measurements are taken the same way each time.
 *
 * This is the metric form (Hodgdon & Beckett, 1984): body density from
 * log10 of centimetre circumferences, then the Siri equation. Note the
 * widely-copied "86.010 · log10(waist − neck) − 70.041 · log10(height) +
 * 36.76" variant takes INCHES — feeding it centimetres overstates fat by
 * 5–25 points, which is exactly what the first draft of this file did.
 */

export interface NavyInputMale {
  sex: 'male';
  heightCm: number;
  waistCm: number;
  neckCm: number;
}

export interface NavyInputFemale {
  sex: 'female';
  heightCm: number;
  waistCm: number;
  neckCm: number;
  hipsCm: number;
}

export type NavyInput = NavyInputMale | NavyInputFemale;

const log10 = (x: number) => Math.log(x) / Math.LN10;

/**
 * Returns body-fat % rounded to one decimal, or null when the inputs
 * cannot produce a meaningful number (non-positive circumferences, a
 * waist no larger than the neck, or a result outside 2–70 %).
 */
export function navyBodyFatPct(input: NavyInput): number | null {
  const { heightCm, waistCm, neckCm } = input;
  if (heightCm <= 0 || waistCm <= 0 || neckCm <= 0) return null;

  let density: number;
  if (input.sex === 'male') {
    if (waistCm <= neckCm) return null;
    density = 1.0324 - 0.19077 * log10(waistCm - neckCm) + 0.15456 * log10(heightCm);
  } else {
    if (input.hipsCm <= 0 || waistCm + input.hipsCm <= neckCm) return null;
    density = 1.29579 - 0.35004 * log10(waistCm + input.hipsCm - neckCm) + 0.221 * log10(heightCm);
  }

  const pct = 495 / density - 450;
  if (!Number.isFinite(pct) || pct < 2 || pct > 70) return null;
  return Math.round(pct * 10) / 10;
}
