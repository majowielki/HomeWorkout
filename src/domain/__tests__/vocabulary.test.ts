import {
  CONSTRAINT_CODES,
  MUSCLE_GROUPS,
  SIGNAL_CODES,
  TREND_VERDICTS,
  VOLUME_STATUSES,
} from '../coach/vocabulary';
import type { MuscleGroup } from '../types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/*
 * Compile-time: the runtime list covers the type exactly. A member added to
 * MuscleGroup without a matching entry fails `tsc` here.
 */
const _muscles: Equal<(typeof MUSCLE_GROUPS)[number], MuscleGroup> = true;
void _muscles;

describe('vocabulary', () => {
  it.each([
    ['MUSCLE_GROUPS', MUSCLE_GROUPS],
    ['SIGNAL_CODES', SIGNAL_CODES],
    ['CONSTRAINT_CODES', CONSTRAINT_CODES],
    ['TREND_VERDICTS', TREND_VERDICTS],
    ['VOLUME_STATUSES', VOLUME_STATUSES],
  ] as const)('%s has no duplicates', (_name, list) => {
    expect(new Set(list).size).toBe(list.length);
  });
});
