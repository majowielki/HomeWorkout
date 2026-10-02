import {
  advanceBlock,
  type BlockContext,
  nextCandidate,
  phaseOf,
  repairSelections,
  rotateSelections,
  withSelection,
} from '../plan/block';
import type { EligibilityContext } from '../plan/eligibility';
import type { BlockState } from '../plan/types';
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

describe('rotateSelections', () => {
  it('takes the first allowed in the first block and leaves out an empty slot', () => {
    expect(rotateSelections(null, [abc, xy, lonely], catalog, eligibility())).toEqual({
      abc: 'a',
      xy: 'x',
    });
  });

  it('moves every slot one candidate on', () => {
    expect(rotateSelections({ abc: 'a', xy: 'y' }, [abc, xy], catalog, eligibility())).toEqual({
      abc: 'b',
      xy: 'x',
    });
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

describe('phaseOf', () => {
  const block: BlockState = {
    index: 1,
    startedOn: '2026-10-01',
    deloadFrom: '2026-10-29',
    deloadReason: 'DELOAD_SCHEDULED',
    selections: {},
  };
  it('is the deload from its first day on', () => {
    expect(phaseOf(block, '2026-10-28')).toBe('work');
    expect(phaseOf(block, '2026-10-29')).toBe('deload');
    expect(phaseOf({ ...block, deloadFrom: null }, '2026-12-01')).toBe('work');
  });
});

describe('advanceBlock', () => {
  const ctx = (patch: Partial<BlockContext> = {}): BlockContext => ({
    asOf: '2026-10-10',
    lastSessionDate: '2026-10-09',
    signals: [],
    slots: [abc, xy],
    catalog,
    eligibility: eligibility(),
    ...patch,
  });
  const block = (patch: Partial<BlockState> = {}): BlockState => ({
    index: 1,
    startedOn: '2026-10-01',
    deloadFrom: null,
    deloadReason: null,
    selections: { abc: 'a', xy: 'x' },
    ...patch,
  });

  it('starts block 1 today', () => {
    expect(advanceBlock(null, ctx({ lastSessionDate: null }))).toEqual({
      block: block({ startedOn: '2026-10-10' }),
      closed: null,
      events: ['BLOCK_STARTED'],
      replacedSlots: [],
    });
  });

  it('changes nothing in an ordinary week', () => {
    expect(advanceBlock(block(), ctx())).toEqual({
      block: block(),
      closed: null,
      events: [],
      replacedSlots: [],
    });
  });

  it('starts the deload after 28 days of work', () => {
    const out = advanceBlock(block(), ctx({ asOf: '2026-10-29', lastSessionDate: '2026-10-28' }));
    expect(out.block).toMatchObject({ deloadFrom: '2026-10-29', deloadReason: 'DELOAD_SCHEDULED' });
    expect(out.events).toEqual(['DELOAD_SCHEDULED']);
  });

  it('starts it early on two signals, but not in the first week', () => {
    const tired = ['FATIGUE_HIGH', 'RECOVERY_LOW'] as const;
    expect(advanceBlock(block(), ctx({ signals: tired })).events).toEqual(['DELOAD_REACTIVE']);
    expect(
      advanceBlock(
        block(),
        ctx({ asOf: '2026-10-05', lastSessionDate: '2026-10-04', signals: tired }),
      ).events,
    ).toEqual([]);
    expect(advanceBlock(block(), ctx({ signals: ['FATIGUE_HIGH'] })).events).toEqual([]);
  });

  it('restarts the work clock after 8 days without a session in the block', () => {
    const out = advanceBlock(block(), ctx({ asOf: '2026-10-20', lastSessionDate: '2026-10-11' }));
    expect(out.block.startedOn).toBe('2026-10-20');
    expect(out.events).toEqual(['BLOCK_CLOCK_RESET']);
    // never trained since the block started
    const idle = advanceBlock(block(), ctx({ asOf: '2026-10-09', lastSessionDate: '2026-09-20' }));
    expect(idle.events).toEqual(['BLOCK_CLOCK_RESET']);
    expect(
      advanceBlock(block(), ctx({ asOf: '2026-10-08', lastSessionDate: null })).events,
    ).toEqual([]);
  });

  it('keeps the deload week going, then rotates into the next block', () => {
    const deloading = block({ deloadFrom: '2026-10-29', deloadReason: 'DELOAD_SCHEDULED' });
    const during = advanceBlock(
      deloading,
      ctx({ asOf: '2026-11-04', lastSessionDate: '2026-10-20' }),
    );
    expect(during.events).toEqual([]);
    expect(during.block).toEqual(deloading);

    const after = advanceBlock(
      deloading,
      ctx({ asOf: '2026-11-05', lastSessionDate: '2026-11-04' }),
    );
    expect(after).toEqual({
      block: {
        index: 2,
        startedOn: '2026-11-05',
        deloadFrom: null,
        deloadReason: null,
        selections: { abc: 'b', xy: 'y' },
      },
      closed: deloading,
      events: ['BLOCK_ROTATED'],
      replacedSlots: [],
    });
  });

  it('repairs a selection the person excluded mid-block', () => {
    const out = advanceBlock(block(), ctx({ eligibility: eligibility(['a']) }));
    expect(out.block.selections).toEqual({ abc: 'b', xy: 'x' });
    expect(out.events).toEqual(['SELECTION_REPLACED']);
    expect(out.replacedSlots).toEqual(['abc']);
  });
});

describe('withSelection', () => {
  it('overrides one slot for the rest of the block', () => {
    const before: BlockState = {
      index: 3,
      startedOn: '2026-10-01',
      deloadFrom: null,
      deloadReason: null,
      selections: { abc: 'a', xy: 'x' },
    };
    expect(withSelection(before, 'abc', 'c').selections).toEqual({ abc: 'c', xy: 'x' });
    expect(before.selections.abc).toBe('a');
  });
});
