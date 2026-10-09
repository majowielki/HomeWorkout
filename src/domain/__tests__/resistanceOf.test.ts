/**
 * Engine v2, P4 (05 §5-§8, T51): the resistance of a catalogue exercise in the
 * resistance model's terms.
 */
import { DEFAULT_MODEL_CONTEXT } from '../resistance/registry';
import { modelFor, modelRefOf, resistanceOf } from '../plan/resistanceOf';
import { exercise, slot } from './fixtures';

const paired = exercise({ id: 'goblet', equipment: ['dumbbell'] });
const single = exercise({ id: 'row', equipment: ['dumbbell'], dumbbellMode: 'single' });
const band = exercise({ id: 'pull', equipment: ['band'], movementPattern: 'Pull' });
const body = exercise({ id: 'crunch', equipment: ['bodyweight'] });
const SLOT = slot({ start: { paired: 4, single: 8, band: 'red' } });

describe('what an exercise is done with', () => {
  it('dumbbells in a pair or alone, a long band with the stretch of its movement, the body', () => {
    expect(modelRefOf(paired)).toEqual({ id: 'dumbbell.paired' });
    expect(modelRefOf(single)).toEqual({ id: 'dumbbell.single' });
    expect(modelRefOf(band)).toEqual({ id: 'band.long', parameters: { romCm: 50 } });
    expect(modelRefOf(body)).toEqual({ id: 'bodyweight', parameters: { variantId: 'crunch' } });
  });
});

describe('where it starts and what its results are compared by', () => {
  it('a start the slot names, on the model that knows the steps', () => {
    const r = resistanceOf(paired, SLOT)!;
    expect(r.model.id).toBe('dumbbell.paired');
    expect(r.start.value).toMatchObject({
      kind: 'external_mass',
      massGrams: 4000,
      convention: 'per_hand',
    });
    expect(resistanceOf(single, SLOT)!.start.value).toMatchObject({
      massGrams: 8000,
      convention: 'total',
    });
    expect(resistanceOf(band, SLOT)!.start.value).toMatchObject({
      kind: 'band_position',
      bandId: 'red',
    });
    expect(resistanceOf(body, SLOT)!.start.value).toMatchObject({
      kind: 'bodyweight',
      variantId: 'crunch',
    });
  });

  it('one key for every step of one setup, another for another setup', () => {
    const key = resistanceOf(paired, SLOT)!.comparisonKey;
    expect(key).toBe(resistanceOf(paired, { ...SLOT, start: { paired: 8 } })!.comparisonKey);
    expect(key).not.toBe(resistanceOf(single, SLOT)!.comparisonKey);
    expect(key.startsWith('goblet|')).toBe(true);
  });

  it('nothing for equipment the engine has no model for (T51)', () => {
    const odd = exercise({ id: 'odd', equipment: ['band'], movementPattern: 'Nowhere' as never });
    expect(resistanceOf(odd, SLOT)).toBeNull();
  });
});

describe('a model for any plan the planner made', () => {
  it('from the spec alone', () => {
    const start = (e: typeof paired) => resistanceOf(e, SLOT)!.start;
    expect(modelFor(start(paired))!.id).toBe('dumbbell.paired');
    expect(modelFor(start(single), DEFAULT_MODEL_CONTEXT)!.id).toBe('dumbbell.single');
    expect(modelFor(start(band))!.id).toBe('band.long');
    expect(modelFor(start(body))!.id).toBe('bodyweight');
  });

  it('none for a model that is not registered', () => {
    const odd = { ...resistanceOf(paired, SLOT)!.start, modelId: 'barbell' };
    expect(modelFor(odd)).toBeNull();
  });
});
