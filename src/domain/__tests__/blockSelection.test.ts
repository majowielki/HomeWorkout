import { nextCandidate, repairSelections } from '../plan/blockSelection';
import type { EligibilityContext } from '../plan/eligibility';
import { byId, exercise, HARD_ONLY, slot } from './fixtures';

const catalog = byId(
  ['a', 'b', 'c', 'x', 'y']
    .map((id) => exercise({ id }))
    .concat(exercise({ id: 'knee-bad', loadsKnee: true, planesOfMotion: ['Frontal'] })),
);
const abc = slot({ id: 'abc', exerciseIds: ['a', 'b', 'c'] });
const xy = slot({ id: 'xy', exerciseIds: ['x', 'y'] });
const lonely = slot({ id: 'lonely', exerciseIds: ['knee-bad'] });

const eligibility = (excluded: string[] = []): EligibilityContext => ({
  profile: HARD_ONLY,
  excludedIds: new Set(excluded),
});

describe('nextCandidate', () => {
  it('starts at the first allowed candidate', () => {
    expect(nextCandidate(abc, undefined, catalog, eligibility())).toBe('a');
    expect(nextCandidate(abc, undefined, catalog, eligibility(['a']))).toBe('b');
  });

  it('moves on after the previous one, wrapping around', () => {
    expect(nextCandidate(abc, 'a', catalog, eligibility())).toBe('b');
    expect(nextCandidate(abc, 'c', catalog, eligibility())).toBe('a');
    expect(nextCandidate(abc, 'a', catalog, eligibility(['b']))).toBe('c');
  });

  it('keeps the previous one only when nothing else is allowed', () => {
    expect(nextCandidate(abc, 'a', catalog, eligibility(['b', 'c']))).toBe('a');
    expect(nextCandidate(abc, 'a', catalog, eligibility(['a', 'b', 'c']))).toBeUndefined();
  });

  it('starts over for an id the slot does not know, and skips unknown ids', () => {
    expect(nextCandidate(abc, 'zzz', catalog, eligibility())).toBe('a');
    const holes = slot({ exerciseIds: ['ghost', 'b'] });
    expect(nextCandidate(holes, undefined, catalog, eligibility())).toBe('b');
    expect(nextCandidate(lonely, undefined, catalog, eligibility())).toBeUndefined();
  });
});

describe('repairSelections', () => {
  it('keeps what is still allowed', () => {
    expect(repairSelections({ abc: 'b', xy: 'x' }, [abc, xy], catalog, eligibility())).toEqual({
      selections: { abc: 'b', xy: 'x' },
      replaced: [],
    });
  });

  it('replaces what is not, fills a new slot and drops one with no candidate', () => {
    expect(
      repairSelections(
        { abc: 'b', lonely: 'knee-bad', stale: 'x' },
        [abc, xy, lonely],
        catalog,
        eligibility(['b']),
      ),
    ).toEqual({ selections: { abc: 'c', xy: 'x' }, replaced: ['abc', 'xy', 'lonely'] });
  });

  it('replaces an exercise that moved out of the slot', () => {
    expect(repairSelections({ abc: 'x' }, [abc], catalog, eligibility())).toEqual({
      selections: { abc: 'a' },
      replaced: ['abc'],
    });
  });
});
