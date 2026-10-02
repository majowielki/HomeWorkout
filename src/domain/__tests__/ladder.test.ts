import {
  BODYWEIGHT_LADDER,
  bandLoadLadder,
  dumbbellLoadLadder,
  ladderFor,
} from '../progression/ladder';
import type { BandCalibration, PlannedLoad } from '../types';
import { exercise, slot } from './fixtures';

const db = (kg: number, mode: 'paired' | 'single' = 'paired'): PlannedLoad => ({
  kind: 'dumbbell',
  mode,
  kg,
});
const band = (bandId: string, position: 0 | 1 | 2 | 3): PlannedLoad => ({
  kind: 'band',
  bandId,
  position,
});
const bw: PlannedLoad = { kind: 'bodyweight' };

/** F(λ) = k·λ, measured far enough that nothing reads as "above". */
const linear = (k: number): BandCalibration => ({
  restLengthCm: 100,
  points: [
    { massKg: 0, lengthCm: 100 },
    { massKg: 18, lengthCm: 400 },
  ],
  fit: { type: 'linear', coeffs: [0, k] },
  maxMeasuredKg: 100,
});

describe('dumbbellLoadLadder', () => {
  const paired = dumbbellLoadLadder('paired', 4);

  it('ranks its own mode only', () => {
    expect(paired.rank(db(6))).toBe(6);
    expect(paired.rank(db(6, 'single'))).toBeNull();
    expect(paired.rank(band('red', 1))).toBeNull();
  });

  it('steps one rung at a time and stops at the ceiling', () => {
    expect(paired.up(db(4))).toEqual({ load: db(6), reason: 'REP_TARGET_MET', confidence: 'high' });
    expect(paired.up(db(10))).toBeNull();
    expect(paired.up(bw)).toBeNull();
    expect(paired.down(db(4))).toEqual(db(2));
    expect(paired.down(db(2))).toBeNull();
    expect(paired.down(bw)).toBeNull();
  });

  it('starts at the slot weight and names its ceiling', () => {
    expect(paired.start).toEqual(db(4));
    expect(paired.ceilingReason).toBe('LOAD_CEILING_REACHED');
    expect(dumbbellLoadLadder('single', 8).up(db(18, 'single'))).toBeNull();
  });
});

describe('bandLoadLadder', () => {
  const ladder = bandLoadLadder('red', 50);

  it('ranks band x position, nothing else', () => {
    expect(ladder.rank(band('yellow', 0))).toBe(0);
    expect(ladder.rank(band('red', 1))).toBe(5);
    expect(ladder.rank(band('pink', 1))).toBeNull();
    expect(ladder.rank(db(4))).toBeNull();
  });

  it('moves one position out (micro)', () => {
    expect(ladder.up(band('red', 1))).toEqual({
      load: band('red', 2),
      reason: 'BAND_MICRO_PROGRESSION',
      confidence: 'high',
    });
  });

  it('goes to the next band at P0 when the jump cannot be estimated (macro)', () => {
    expect(ladder.up(band('red', 3))).toEqual({
      load: band('black', 0),
      reason: 'BAND_MACRO_PROGRESSION',
      confidence: 'low',
    });
  });

  it('lands on P1 for a jump of at most 15%, on P0 above it', () => {
    // red P3 peak: 5 × 2.4 = 12 kg; black P1 peak: k × 1.8
    // peaks are whole kilograms: 12 -> 13 is +8%
    const gentle = bandLoadLadder('red', 50, { red: linear(5), black: linear(7) });
    expect(gentle.up(band('red', 3))).toEqual({
      load: band('black', 1),
      reason: 'BAND_MACRO_PROGRESSION',
      confidence: 'high',
    });
    const steep = bandLoadLadder('red', 50, { red: linear(5), black: linear(10) });
    expect(steep.up(band('red', 3))?.load).toEqual(band('black', 0));
  });

  it('treats a zero force at the old setting as not measurable', () => {
    const flat = bandLoadLadder('red', 50, { red: linear(0), black: linear(7.5) });
    expect(flat.up(band('red', 3))).toMatchObject({ load: band('black', 0), confidence: 'low' });
  });

  it('stops at green P3 and on anything it cannot place', () => {
    expect(ladder.up(band('green', 3))).toBeNull();
    expect(ladder.up(band('pink', 1))).toBeNull();
    expect(ladder.up(db(4))).toBeNull();
  });

  it('steps down a position, then to the band below at P3, then stops', () => {
    expect(ladder.down(band('red', 1))).toEqual(band('red', 0));
    expect(ladder.down(band('red', 0))).toEqual(band('yellow', 3));
    expect(ladder.down(band('yellow', 0))).toBeNull();
    expect(ladder.down(band('pink', 2))).toBeNull();
    expect(ladder.down(db(4))).toBeNull();
  });

  it('starts at the slot band, P1, falling back to the lightest band', () => {
    expect(ladder.start).toEqual(band('red', 1));
    expect(bandLoadLadder('pink', 50).start).toEqual(band('yellow', 1));
  });
});

describe('snap', () => {
  it('keeps a load the equipment can make and lowers one it cannot', () => {
    const paired = dumbbellLoadLadder('paired', 4);
    expect(paired.snap(db(6))).toEqual(db(6));
    expect(paired.snap(db(7))).toEqual(db(6));
    expect(paired.snap(db(1))).toEqual(db(2));
    expect(paired.snap(band('red', 1))).toBeNull();
  });

  it('accepts known bands only, and bodyweight on its own ladder', () => {
    const ladder = bandLoadLadder('red', 50);
    expect(ladder.snap(band('red', 2))).toEqual(band('red', 2));
    expect(ladder.snap(band('pink', 2))).toBeNull();
    expect(ladder.snap(db(4))).toBeNull();
    expect(BODYWEIGHT_LADDER.snap(bw)).toEqual(bw);
    expect(BODYWEIGHT_LADDER.snap(db(4))).toBeNull();
  });
});

describe('BODYWEIGHT_LADDER', () => {
  it('has a single rung and its own ceiling', () => {
    expect(BODYWEIGHT_LADDER.rank(bw)).toBe(0);
    expect(BODYWEIGHT_LADDER.rank(db(2))).toBeNull();
    expect(BODYWEIGHT_LADDER.up(bw)).toBeNull();
    expect(BODYWEIGHT_LADDER.down(bw)).toBeNull();
    expect(BODYWEIGHT_LADDER.ceilingReason).toBe('BODYWEIGHT_CEILING');
  });
});

describe('ladderFor', () => {
  it('picks the ladder from the equipment and the start from the slot', () => {
    const s = slot({ start: { paired: 4, single: 8, band: 'black' } });
    expect(ladderFor(exercise({ equipment: ['band'] }), s).start).toEqual(band('black', 1));
    expect(
      ladderFor(exercise({ equipment: ['dumbbell'], dumbbellMode: 'single' }), s).start,
    ).toEqual(db(8, 'single'));
    expect(ladderFor(exercise({ equipment: ['dumbbell'] }), s).start).toEqual(db(4));
    expect(ladderFor(exercise(), s)).toBe(BODYWEIGHT_LADDER);
  });

  it('falls back to the lightest band and the lightest rung when the slot is silent', () => {
    const s = slot({ start: {} });
    expect(ladderFor(exercise({ equipment: ['band'] }), s).start).toEqual(band('yellow', 1));
    expect(ladderFor(exercise({ equipment: ['dumbbell'] }), s).start).toEqual(db(2));
  });
});
