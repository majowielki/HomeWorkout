/**
 * Engine v2, P3 (13 §19, 12 §5.5, T96): the volume lever.
 */
import { MUSCLE_GROUPS } from '../coach/vocabulary';
import type { MuscleWork } from '../history';
import type { DailyReadiness } from '../plan/types';
import { assess } from '../progression/assessed';
import { DEFAULT_PROGRESSION_POLICY } from '../progression/policy';
import type { MuscleGroup } from '../types';
import { volumeTargets } from '../policy/dayPolicy';
import { volumeRecommendation, type LeverInput } from '../volume/lever';
import { PAIRED, day, exposureOf, kg } from './progressionFixtures';

/** Days on which the muscle did direct work. */
function worked(muscle: MuscleGroup, days: number[]): LeverInput['idx'] {
  const muscleDay = new Map<string, Record<MuscleGroup, MuscleWork>>();
  for (const d of days) {
    const row = Object.fromEntries(
      MUSCLE_GROUPS.map((m) => [m, { certain: m === muscle ? 2 : 0, uncertain: 0, secondary: 0 }]),
    ) as Record<MuscleGroup, MuscleWork>;
    muscleDay.set(day(d), row);
  }
  return { muscleDay };
}

const every3 = (from: number, to: number) =>
  Array.from({ length: Math.floor((to - from) / 3) + 1 }, (_, i) => from + i * 3);
const stuck = assess(
  [0, 2, 4].map((d) => exposureOf({ date: day(d), spec: kg(4), sets: [10, 10] })),
  DEFAULT_PROGRESSION_POLICY,
  PAIRED,
);
const moving = assess(
  [9, 10, 11].map((r, i) => exposureOf({ date: day(i * 2), spec: kg(4), sets: [r, r] })),
  DEFAULT_PROGRESSION_POLICY,
  PAIRED,
);
const key = (history: typeof stuck) => ({ history, model: PAIRED });
const sore = (date: number, level = 4): DailyReadiness => ({
  date: day(date),
  sleepHours: 8,
  energy: 4,
  soreness: { quads: level },
});

const input = (patch: Partial<LeverInput> = {}): LeverInput => ({
  asOf: day(40),
  idx: worked('quads', every3(10, 40)),
  keyExercises: { quads: [key(stuck)] },
  daily: [],
  signals: [],
  ...patch,
});

describe('T96 more: trained for a month, standing still, recovering well', () => {
  it('+20% rounded up, from 6 to 8', () => {
    expect(volumeRecommendation(input())).toEqual([
      {
        muscle: 'quads',
        change: 'increase',
        fromMax: 6,
        toMax: 8,
        reasons: ['STALLED_WELL_RECOVERED'],
      },
    ]);
  });

  it('from what the person set before, and never past the top of the higher profile', () => {
    expect(
      volumeRecommendation(
        input({
          targets: volumeTargets({ volumeProfile: 'standard', volumeOverrides: { quads: 8 } }),
        }),
      )[0],
    ).toMatchObject({
      fromMax: 8,
      toMax: 10,
    });
    expect(
      volumeRecommendation(
        input({
          targets: volumeTargets({ volumeProfile: 'standard', volumeOverrides: { quads: 10 } }),
        }),
      ),
    ).toEqual([]);
    expect(
      volumeRecommendation(
        input({
          targets: volumeTargets({ volumeProfile: 'standard', volumeOverrides: { quads: 9 } }),
        }),
      )[0],
    ).toMatchObject({
      toMax: 10,
    });
  });

  it('the muscles with a higher maximum of their own start from it', () => {
    const glutes = input({
      idx: worked('glutes', every3(10, 40)),
      keyExercises: { glutes: [key(stuck)] },
    });
    expect(volumeRecommendation(glutes)[0]).toMatchObject({
      muscle: 'glutes',
      fromMax: 8,
      toMax: 10,
    });
  });

  it('not before a month without a break', () => {
    expect(volumeRecommendation(input({ idx: worked('quads', every3(20, 40)) }))).toEqual([]);
    const broken = [...every3(10, 22), ...every3(32, 40)];
    expect(volumeRecommendation(input({ idx: worked('quads', broken) }))).toEqual([]);
  });

  it('not for a muscle that has not been trained lately', () => {
    expect(volumeRecommendation(input({ idx: worked('quads', every3(10, 28)) }))).toEqual([]);
    expect(volumeRecommendation(input({ idx: worked('quads', []) }))).toEqual([]);
  });

  it('not while its key lifts move, or with none to judge by', () => {
    expect(volumeRecommendation(input({ keyExercises: { quads: [key(moving)] } }))).toEqual([]);
    expect(
      volumeRecommendation(input({ keyExercises: { quads: [key(stuck), key(moving)] } })),
    ).toEqual([]);
    expect(volumeRecommendation(input({ keyExercises: {} }))).toEqual([]);
  });

  it('days with no soreness logged, or other muscles sore, do not count', () => {
    const blank = { date: day(30), sleepHours: 8, energy: 4, soreness: null };
    const elsewhere = { ...blank, soreness: { glutes: 5 } };
    expect(volumeRecommendation(input({ daily: [blank, elsewhere] }))).toHaveLength(1);
  });

  it('not after a sore day this fortnight', () => {
    expect(volumeRecommendation(input({ daily: [sore(30)] }))).toEqual([]);
    expect(volumeRecommendation(input({ daily: [sore(20)] }))).toHaveLength(1);
    expect(volumeRecommendation(input({ daily: [sore(35, 3)] }))).toHaveLength(1);
  });

  it('not when recovery is poor', () => {
    expect(
      volumeRecommendation(input({ signals: ['RECOVERY_LOW'] })).every(
        (c) => c.change === 'decrease',
      ),
    ).toBe(true);
  });
});

describe('T96 less: sore often, or recovery poor', () => {
  it('sore on three of the last seven days: −20%', () => {
    const cards = volumeRecommendation(input({ daily: [sore(34), sore(37), sore(40)] }));
    expect(cards).toEqual([
      { muscle: 'quads', change: 'decrease', fromMax: 6, toMax: 5, reasons: ['FREQUENT_SORENESS'] },
    ]);
  });

  it('twice is not often', () => {
    expect(volumeRecommendation(input({ daily: [sore(37), sore(40)] }))).toEqual([]);
    expect(volumeRecommendation(input({ daily: [sore(30), sore(31), sore(32)] }))).toEqual([]);
  });

  it('poor recovery lowers every muscle in training, and says why', () => {
    const cards = volumeRecommendation(input({ signals: ['RECOVERY_LOW'] }));
    expect(cards).toEqual([
      { muscle: 'quads', change: 'decrease', fromMax: 6, toMax: 5, reasons: ['RECOVERY_LOW'] },
    ]);
    const both = volumeRecommendation(
      input({ signals: ['RECOVERY_LOW'], daily: [sore(38), sore(39), sore(40)] }),
    );
    expect(both[0]!.reasons).toEqual(['RECOVERY_LOW', 'FREQUENT_SORENESS']);
  });

  it('never under the minimum', () => {
    expect(
      volumeRecommendation(
        input({
          signals: ['RECOVERY_LOW'],
          targets: volumeTargets({ volumeProfile: 'standard', volumeOverrides: { quads: 3 } }),
        }),
      ),
    ).toEqual([]);
    expect(
      volumeRecommendation(
        input({
          signals: ['RECOVERY_LOW'],
          targets: volumeTargets({ volumeProfile: 'standard', volumeOverrides: { quads: 4 } }),
        }),
      )[0],
    ).toMatchObject({ toMax: 3 });
  });
});
