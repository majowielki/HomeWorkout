/**
 * How far to trust the judge: compare its ratings with a person's, on
 * answers the person has rated by hand (AI-INTEGRACJA §5.2, research R8).
 *
 * Reported per criterion: exact agreement, agreement within one point,
 * mean absolute error, mean bias (positive = the judge is kinder) and
 * quadratic-weighted Cohen's kappa, the usual measure for an ordinal scale.
 * The judge is only used in a report if it clears the thresholds.
 */
import { CRITERIA, type Criterion } from './rubric';

export type Ratings = Record<Criterion, number>;

export interface RatedPair {
  human: Ratings;
  judge: Ratings;
}

export interface CriterionAgreement {
  n: number;
  exact: number;
  withinOne: number;
  meanAbsoluteError: number;
  bias: number;
  kappa: number;
}

export type Calibration = Record<Criterion, CriterionAgreement> & { trusted: boolean };

/** What "good enough to use" means. Chosen before looking at any data, and kept here so it cannot drift. */
export const TRUST = { minPairs: 20, minWithinOne: 0.9, minKappa: 0.6 } as const;

const SCALE = 5;

/** Quadratic-weighted kappa on a 1..5 scale; 1 = perfect, 0 = chance, negative = worse than chance. */
export function quadraticKappa(human: readonly number[], judge: readonly number[]): number {
  const n = human.length;
  const observed = Array.from({ length: SCALE }, () => new Array<number>(SCALE).fill(0));
  const humanCounts = new Array<number>(SCALE).fill(0);
  const judgeCounts = new Array<number>(SCALE).fill(0);
  human.forEach((h, i) => {
    const j = judge[i]!;
    observed[h - 1]![j - 1]! += 1;
    humanCounts[h - 1]! += 1;
    judgeCounts[j - 1]! += 1;
  });

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < SCALE; i += 1) {
    for (let j = 0; j < SCALE; j += 1) {
      const weight = (i - j) ** 2 / (SCALE - 1) ** 2;
      numerator += weight * observed[i]![j]!;
      denominator += weight * ((humanCounts[i]! * judgeCounts[j]!) / n);
    }
  }
  // Everyone gave the same rating on both sides: nothing to disagree about.
  return denominator === 0 ? 1 : 1 - numerator / denominator;
}

function agreement(human: number[], judge: number[]): CriterionAgreement {
  const n = human.length;
  const diffs = human.map((h, i) => judge[i]! - h);
  const count = (test: (d: number) => boolean) => diffs.filter(test).length / n;
  return {
    n,
    exact: count((d) => d === 0),
    withinOne: count((d) => Math.abs(d) <= 1),
    meanAbsoluteError: diffs.reduce((s, d) => s + Math.abs(d), 0) / n,
    bias: diffs.reduce((s, d) => s + d, 0) / n,
    kappa: quadraticKappa(human, judge),
  };
}

export function calibrate(pairs: readonly RatedPair[]): Calibration {
  if (pairs.length === 0) throw new Error('Calibration needs at least one rated answer.');
  const out = {} as Calibration;
  for (const criterion of CRITERIA) {
    out[criterion] = agreement(
      pairs.map((p) => p.human[criterion]),
      pairs.map((p) => p.judge[criterion]),
    );
  }
  out.trusted =
    pairs.length >= TRUST.minPairs &&
    CRITERIA.every((c) => out[c].withinOne >= TRUST.minWithinOne && out[c].kappa >= TRUST.minKappa);
  return out;
}

export function renderCalibration(result: Calibration, pairs: number): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const lines = [
    `Judge calibration on ${pairs} hand-rated answers: **${result.trusted ? 'trusted' : 'not trusted'}**`,
    `(needs at least ${TRUST.minPairs} answers, within-one agreement of ${pct(TRUST.minWithinOne)} and kappa of ${TRUST.minKappa} on every criterion)`,
    '',
    '| Criterion | Exact | Within 1 | MAE | Bias | Kappa |',
    '|---|---|---|---|---|---|',
  ];
  for (const c of CRITERIA) {
    const a = result[c];
    lines.push(
      `| ${c} | ${pct(a.exact)} | ${pct(a.withinOne)} | ${a.meanAbsoluteError.toFixed(2)} | ${a.bias >= 0 ? '+' : ''}${a.bias.toFixed(2)} | ${a.kappa.toFixed(2)} |`,
    );
  }
  return lines.join('\n') + '\n';
}
