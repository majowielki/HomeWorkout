/**
 * Engine v2, P3 (13 §19, D32): the cards of the volume lever, made from what the planner reads.
 */
import { addDays } from '../time/trainingDate';
import { resistanceOf } from '../plan/resistanceOf';
import { defaultPreferences } from '../preferences/preferences';
import { volumeCardsFor } from '../volume/cards';
import { CATALOG, SELECTIONS, SLOTS } from './dayFixtures';
import { exposureOf } from './progressionFixtures';

const FROM = '2026-08-01';
const compounds = SLOTS.filter((slot) => slot.kind === 'compound').map((slot) => {
  const exercise = CATALOG[SELECTIONS[slot.id]!]!;
  return { slot, exercise, res: resistanceOf(exercise, slot)! };
});
const { exercise } = compounds[0]!;

/** Every compound lift every third day, always the same result: they stand still. */
const stuck = compounds.flatMap(({ slot, exercise, res }) =>
  Array.from({ length: 14 }, (_, i) =>
    exposureOf({
      date: addDays(FROM, i * 3),
      spec: res.start,
      sets: [10, 10],
      key: res.comparisonKey,
      exerciseId: exercise.id,
      slotId: slot.id,
    }),
  ),
);

const base = {
  asOf: addDays(FROM, 39),
  catalog: CATALOG,
  slots: SLOTS,
  block: { selections: SELECTIONS },
  records: stuck,
  daily: [],
  preferences: defaultPreferences(),
};

describe('the cards of the volume lever', () => {
  it('offers more for the muscles of a key lift that stands still after a month of training', () => {
    const cards = volumeCardsFor(base);
    const main = cards.find((c) => exercise.primaryMuscles.includes(c.muscle));
    expect(main).toMatchObject({ change: 'increase', reasons: ['STALLED_WELL_RECOVERED'] });
    expect(main!.toMax).toBeGreaterThan(main!.fromMax);
  });

  it('starts from the profile and the maxima the person has set', () => {
    const muscle = exercise.primaryMuscles[0]!;
    const own = volumeCardsFor({
      ...base,
      preferences: { ...defaultPreferences(), volumeOverrides: { [muscle]: 8 } },
    }).find((c) => c.muscle === muscle);
    expect(own).toMatchObject({ fromMax: 8 });
    const higher = volumeCardsFor({
      ...base,
      preferences: { ...defaultPreferences(), volumeProfile: 'higher' },
    }).find((c) => c.muscle === muscle);
    // The top of the higher profile is the ceiling of the lever.
    expect(higher).toBeUndefined();
  });

  it('offers nothing without a block, a history, or a month of training', () => {
    expect(volumeCardsFor({ ...base, block: null })).toEqual([]);
    expect(volumeCardsFor({ ...base, records: [] })).toEqual([]);
    expect(
      volumeCardsFor({ ...base, records: stuck.slice(0, 4), asOf: addDays(FROM, 10) }),
    ).toEqual([]);
  });

  it('offers less when recovery is poor', () => {
    const daily = Array.from({ length: 7 }, (_, i) => ({
      date: addDays(base.asOf, -i),
      sleepHours: 4,
      energy: 1,
      soreness: {},
    }));
    const cards = volumeCardsFor({ ...base, daily });
    expect(cards.some((c) => c.change === 'decrease')).toBe(true);
  });

  it('ignores the key lifts it cannot judge: a slot without an exercise, or one the catalogue lacks', () => {
    const gone = Object.fromEntries(compounds.map(({ slot }) => [slot.id, 'gone']));
    expect(volumeCardsFor({ ...base, block: { selections: gone } })).toEqual([]);
    expect(volumeCardsFor({ ...base, block: { selections: {} } })).toEqual([]);
  });
});
