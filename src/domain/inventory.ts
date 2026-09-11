/**
 * Physical equipment on hand, and the discrete load ladders it produces.
 *
 * The ladders are derived rather than hand-written: plates must sit
 * symmetrically on a bar, so a 1 kg plate raises the dumbbell by 2 kg.
 * That 2 kg step is the smallest increment available and it is large —
 * going 8 kg -> 10 kg is +25%. The engine therefore gates progression on
 * hitting the full rep target rather than on a percentage cap.
 * See Documents/SPEC-silnik-regul.md §5.0-5.1.
 */

export interface PlateStock {
  massKg: number;
  count: number;
}

export interface DumbbellInventory {
  bars: number;
  barMassKg: number;
  plates: PlateStock[];
}

export interface BandSpec {
  id: string;
  label: string;
  nominalMinKg: number;
  nominalMaxKg: number;
}

export const DUMBBELLS: DumbbellInventory = {
  bars: 2,
  // Derived from the set's advertised 20 kg total: 16 kg of plates + 2 bars.
  // TODO: weigh a bare bar and correct if needed — it shifts the whole ladder.
  barMassKg: 2,
  plates: [
    { massKg: 1, count: 8 },
    { massKg: 2, count: 4 },
  ],
};

export const BANDS: BandSpec[] = [
  { id: 'yellow', label: 'żółta', nominalMinKg: 2, nominalMaxKg: 7 },
  { id: 'red', label: 'czerwona', nominalMinKg: 8, nominalMaxKg: 11 },
  { id: 'black', label: 'czarna', nominalMinKg: 12, nominalMaxKg: 17 },
  { id: 'purple', label: 'fioletowa', nominalMinKg: 17, nominalMaxKg: 26 },
  { id: 'green', label: 'zielona', nominalMinKg: 27, nominalMaxKg: 45 },
];

/**
 * Every distinct total mass obtainable from a multiset of plates.
 *
 * Each plate type is folded in once, against the sums reachable before it
 * was considered — otherwise a type could be spent more times than the
 * stock actually holds.
 */
function reachableSums(plates: PlateStock[]): number[] {
  let sums = new Set<number>([0]);

  for (const { massKg, count } of plates) {
    const expanded = new Set<number>();
    for (const existing of sums) {
      for (let used = 0; used <= count; used += 1) {
        // Rounded because plate masses may be fractional (e.g. 1.25 kg).
        expanded.add(Math.round((existing + massKg * used) * 100) / 100);
      }
    }
    sums = expanded;
  }

  return [...sums].sort((a, b) => a - b);
}

/** Halve the plate stock, dropping any odd remainder that cannot be paired. */
function halveStock(plates: PlateStock[]): PlateStock[] {
  return plates.map(({ massKg, count }) => ({ massKg, count: Math.floor(count / 2) }));
}

/**
 * Loadable weights for one dumbbell, ascending.
 *
 * 'paired' splits the plates across both bars (what you can hold in each
 * hand); 'single' puts every plate on one bar, which is what goblet squats
 * and one-arm rows actually use — and the reason the lower-body ceiling is
 * 18 kg rather than 10 kg.
 */
export function dumbbellLadder(
  mode: 'paired' | 'single',
  inventory: DumbbellInventory = DUMBBELLS,
): number[] {
  const stockForOneBar = mode === 'paired' ? halveStock(inventory.plates) : inventory.plates;
  const perSide = halveStock(stockForOneBar);
  return reachableSums(perSide).map((side) => inventory.barMassKg + side * 2);
}

export const LADDER_PAIRED: number[] = dumbbellLadder('paired');
export const LADDER_SINGLE: number[] = dumbbellLadder('single');

/** Heaviest mass available to hang from a band during calibration. */
export const MAX_CALIBRATION_MASS_KG: number = Math.max(...LADDER_SINGLE);

/** Next rung up, or the same weight when already at the ceiling. */
export function nextRung(ladder: number[], current: number): number {
  const i = ladder.indexOf(current);
  if (i === -1) {
    return ladder.find((w) => w > current) ?? (ladder[ladder.length - 1] as number);
  }
  return ladder[Math.min(i + 1, ladder.length - 1)] as number;
}

/** Next rung down, or the same weight when already at the lightest. */
export function previousRung(ladder: number[], current: number): number {
  const i = ladder.indexOf(current);
  if (i === -1) {
    return [...ladder].reverse().find((w) => w < current) ?? (ladder[0] as number);
  }
  return ladder[Math.max(i - 1, 0)] as number;
}

export function isAtCeiling(ladder: number[], current: number): boolean {
  return current >= (ladder[ladder.length - 1] as number);
}
