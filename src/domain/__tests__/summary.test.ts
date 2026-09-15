import {
  countWorkingSets,
  durationMinutes,
  groupSetsByExercise,
  type HistorySet,
} from '../history/summary';

function set(overrides: Partial<HistorySet> & Pick<HistorySet, 'id'>): HistorySet {
  return {
    exerciseId: 'goblet-squat',
    exerciseOrder: 0,
    setIndex: 1,
    isWarmup: false,
    loggedAt: '2026-09-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('groupSetsByExercise', () => {
  it('returns no groups for no sets', () => {
    expect(groupSetsByExercise([])).toEqual([]);
  });

  it('groups by exerciseOrder and orders groups by position, not by insertion', () => {
    const groups = groupSetsByExercise([
      set({ id: 'b1', exerciseId: 'row', exerciseOrder: 1 }),
      set({ id: 'a1', exerciseOrder: 0 }),
      set({ id: 'b2', exerciseId: 'row', exerciseOrder: 1, setIndex: 2 }),
    ]);
    expect(groups.map((g) => g.exerciseId)).toEqual(['goblet-squat', 'row']);
    expect(groups[1]?.sets.map((s) => s.id)).toEqual(['b1', 'b2']);
  });

  it('sorts sets by index, then by time for duplicate indices', () => {
    const groups = groupSetsByExercise([
      set({ id: 'later', setIndex: 1, loggedAt: '2026-09-15T10:05:00.000Z' }),
      set({ id: 'third', setIndex: 3 }),
      set({ id: 'earlier', setIndex: 1, loggedAt: '2026-09-15T10:01:00.000Z' }),
    ]);
    expect(groups[0]?.sets.map((s) => s.id)).toEqual(['earlier', 'later', 'third']);
  });

  it('does not mutate the input', () => {
    const input = [set({ id: 'x', setIndex: 2 }), set({ id: 'y', setIndex: 1 })];
    groupSetsByExercise(input);
    expect(input.map((s) => s.id)).toEqual(['x', 'y']);
  });
});

describe('countWorkingSets', () => {
  it('excludes warm-up sets', () => {
    expect(
      countWorkingSets([set({ id: '1', isWarmup: true }), set({ id: '2' }), set({ id: '3' })]),
    ).toBe(2);
  });
});

describe('durationMinutes', () => {
  it('rounds to whole minutes', () => {
    expect(durationMinutes('2026-09-15T10:00:00.000Z', '2026-09-15T10:42:29.000Z')).toBe(42);
    expect(durationMinutes('2026-09-15T10:00:00.000Z', '2026-09-15T10:42:31.000Z')).toBe(43);
  });

  it('is null for an unfinished session', () => {
    expect(durationMinutes('2026-09-15T10:00:00.000Z', null)).toBeNull();
  });

  it('is null when the finish precedes the start or a timestamp is garbage', () => {
    expect(durationMinutes('2026-09-15T10:00:00.000Z', '2026-09-15T09:00:00.000Z')).toBeNull();
    expect(durationMinutes('nope', '2026-09-15T09:00:00.000Z')).toBeNull();
  });
});
