import exercisesJson from '@data/exercises.json';
import slotsJson from '@data/slots.json';
import { slotCatalogueSchema } from '@data/slots.schema';

import { BANDS } from '../inventory';
import { slotCatalogProblems, type SlotCatalogContext } from '../plan/slotCatalog';
import type { Exercise } from '../types';
import { DOCUMENTED_KNEE, exercise, slot } from './fixtures';

const ctx: SlotCatalogContext = {
  knee: { ...DOCUMENTED_KNEE, physioApproved: true },
  bandIds: ['red', 'black'],
};

const squat = exercise({ id: 'squat' });
const plank = exercise({
  id: 'plank',
  movementPattern: 'Core',
  forceProfile: 'Isometric',
});
const bike = exercise({ id: 'bike', movementPattern: 'Cardio', equipment: ['bike'] });
const catCow = exercise({ id: 'cat-cow', movementPattern: 'Mobility' });

describe('slotCatalogProblems', () => {
  it('accepts a consistent catalogue', () => {
    const slots = [
      slot({ id: 'squat', exerciseIds: ['squat'] }),
      slot({ id: 'core', kind: 'core', exerciseIds: ['plank'], timeRange: [20, 60] }),
      slot({ id: 'mobility', kind: 'filler', exerciseIds: ['cat-cow'] }),
    ];
    expect(slotCatalogProblems(slots, [squat, plank, bike, catCow], ctx)).toEqual([]);
  });

  it('reports duplicate slots, unknown ids and an exercise in two slots', () => {
    const slots = [
      slot({ id: 'a', exerciseIds: ['squat', 'ghost'] }),
      slot({ id: 'a', exerciseIds: ['squat'] }),
    ];
    expect(slotCatalogProblems(slots, [squat], ctx)).toEqual([
      'a: unknown exercise "ghost"',
      'duplicate slot id: a',
      'squat: in two slots, a and a',
    ]);
  });

  it('reports an orphan exercise and cardio inside a slot', () => {
    const slots = [slot({ id: 'a', exerciseIds: ['squat', 'bike'] })];
    expect(slotCatalogProblems(slots, [squat, bike, plank], ctx)).toEqual([
      'bike: cardio is planned on its own, not in a slot',
      'plank: not in any slot',
    ]);
  });

  it('ignores archived exercises when looking for orphans', () => {
    const slots = [slot({ id: 'a', exerciseIds: ['squat'] })];
    expect(slotCatalogProblems(slots, [squat, { ...plank, archived: true }], ctx)).toEqual([]);
  });

  it('wants a candidate the knee allows', () => {
    const lateral = exercise({ id: 'lateral', loadsKnee: true, planesOfMotion: ['Frontal'] });
    expect(
      slotCatalogProblems([slot({ id: 'a', exerciseIds: ['lateral'] })], [lateral], ctx),
    ).toEqual(['a: no candidate passes the knee filter']);
  });

  it('keeps mobility in filler slots and filler slots for mobility', () => {
    const slots = [
      slot({ id: 'a', exerciseIds: ['squat', 'cat-cow'] }),
      slot({ id: 'b', kind: 'filler', exerciseIds: ['plank'], timeRange: [20, 60] }),
    ];
    expect(slotCatalogProblems(slots, [squat, catCow, plank], ctx)).toEqual([
      'a/cat-cow: filler slots hold mobility work and only they do',
      'b/plank: filler slots hold mobility work and only they do',
    ]);
  });

  it('needs the right range for reps and for holds', () => {
    const slots = [
      slot({ id: 'a', exerciseIds: ['squat'], repRange: undefined }),
      slot({ id: 'b', kind: 'core', exerciseIds: ['plank'], timeRange: undefined }),
    ];
    expect(slotCatalogProblems(slots, [squat, plank], ctx)).toEqual([
      'a/squat: counted in reps, but the slot has no repRange',
      'b/plank: isometric, but the slot has no timeRange',
    ]);
  });

  it('needs a start weight on the ladder of the right mode', () => {
    const paired = exercise({ id: 'press', equipment: ['dumbbell'], dumbbellMode: 'paired' });
    const single = exercise({ id: 'goblet', equipment: ['dumbbell'], dumbbellMode: 'single' });
    const slots = [
      slot({ id: 'a', exerciseIds: ['press'], start: {} }),
      slot({ id: 'b', exerciseIds: ['goblet'], start: { single: 7 } }),
    ];
    expect(slotCatalogProblems(slots, [paired, single], ctx)).toEqual([
      'a/press: no start.paired weight',
      'b/goblet: start.single 7 kg is not on the single ladder',
    ]);
  });

  it('needs a known start band', () => {
    const row = exercise({ id: 'row', equipment: ['band'] });
    const slots = [
      slot({ id: 'a', exerciseIds: ['row'], start: {} }),
      slot({ id: 'b', exerciseIds: ['row'], start: { band: 'pink' } }),
    ];
    expect(slotCatalogProblems(slots, [row], ctx)).toContain('a/row: no start.band');
    expect(slotCatalogProblems(slots, [row], ctx)).toContain('b/row: unknown start band "pink"');
  });
});

describe('the shipped data/slots.json', () => {
  const exercises = (exercisesJson as { exercises: Exercise[] }).exercises;
  const { slots } = slotCatalogueSchema.parse(slotsJson);

  it('has no problems for the documented knee without the conservative mode', () => {
    expect(
      slotCatalogProblems(slots, exercises, { knee: ctx.knee, bandIds: BANDS.map((b) => b.id) }),
    ).toEqual([]);
  });

  it('starts every slot with its easiest candidate in mind: the first one is allowed', () => {
    // Not a hard rule, but the rotation starts at the first allowed one and
    // the list is meant to begin with the gentlest variant.
    const lunge = slots.find((s) => s.id === 'lunge')!;
    expect(lunge.exerciseIds[0]).toBe('split-squat');
  });
});
