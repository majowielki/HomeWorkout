import { dumbbellModeOf, type LoggedLoad, loadKindOf, loadOfSet } from '../progression/load';

describe('loadKindOf', () => {
  it.each([
    [['band'], 'band'],
    [['band', 'bodyweight', 'mat'], 'band'],
    [['dumbbell'], 'dumbbell'],
    [['dumbbell', 'bodyweight'], 'dumbbell'],
    [['bodyweight', 'mat'], 'bodyweight'],
    [['bike'], 'bodyweight'],
    [['mini-band'], 'bodyweight'],
  ] as const)('%j -> %s', (equipment, kind) => {
    expect(loadKindOf({ equipment: [...equipment] })).toBe(kind);
  });
});

describe('dumbbellModeOf', () => {
  it('reads the declared mode and falls back to paired', () => {
    expect(dumbbellModeOf({ dumbbellMode: 'single' })).toBe('single');
    expect(dumbbellModeOf({ dumbbellMode: 'paired' })).toBe('paired');
    expect(dumbbellModeOf({})).toBe('paired');
  });
});

describe('loadOfSet', () => {
  const none: LoggedLoad = {
    weightKg: null,
    dumbbellMode: null,
    bandId: null,
    anchorPosition: null,
  };

  it('reads a band and keeps positions 1-3', () => {
    expect(loadOfSet({ ...none, bandId: 'red', anchorPosition: 2 })).toEqual({
      kind: 'band',
      bandId: 'red',
      position: 2,
    });
  });

  it.each([0, null, 7])('turns band position %s into 0', (anchorPosition) => {
    expect(loadOfSet({ ...none, bandId: 'red', anchorPosition })).toEqual({
      kind: 'band',
      bandId: 'red',
      position: 0,
    });
  });

  it('reads a dumbbell, defaulting a missing mode to single', () => {
    expect(loadOfSet({ ...none, weightKg: 8, dumbbellMode: 'paired' })).toEqual({
      kind: 'dumbbell',
      mode: 'paired',
      kg: 8,
    });
    expect(loadOfSet({ ...none, weightKg: 8 })).toEqual({
      kind: 'dumbbell',
      mode: 'single',
      kg: 8,
    });
  });

  it('is bodyweight without a band or a positive weight', () => {
    expect(loadOfSet(none)).toEqual({ kind: 'bodyweight' });
    expect(loadOfSet({ ...none, weightKg: 0 })).toEqual({ kind: 'bodyweight' });
  });
});
