/**
 * Engine v2, P3/P4 (03 §9, §16, D31, T35, T93, T94): the block of the second
 * engine — 35 days, rotation by evidence, a deload only when asked for.
 */
import { advanceBlock, type BlockContext, phaseOf } from '../plan/block';
import { defaultPreferences } from '../preferences/preferences';
import type { BlockState } from '../plan/types';
import { addDays } from '../time/trainingDate';
import { exercise, slot } from './fixtures';

const catalog = Object.fromEntries(
  ['a', 'b', 'c'].map((id) => [id, exercise({ id, equipment: ['dumbbell'] })]),
);
const slots = [slot({ id: 'squat', exerciseIds: ['a', 'b', 'c'] })];
const START = '2026-10-05';

const context = (patch: Partial<BlockContext> = {}): BlockContext => ({
  asOf: START,
  lastSessionDate: null,
  slots,
  catalog,
  eligibility: { profile: { knee: null }, excludedIds: new Set() },
  preferences: defaultPreferences(),
  evidence: () => ({ qualifiedExposures: 6, progressing: false }),
  recentBlocks: [],
  deload: { signals: [], keyExercises: [], daily: [], requested: false },
  ...patch,
});
const block = (patch: Partial<BlockState> = {}): BlockState => ({
  index: 1,
  startedOn: START,
  deloadFrom: null,
  deloadReason: null,
  selections: { squat: 'a' },
  ...patch,
});

describe('the first block', () => {
  it('starts today with the first allowed variant of every slot', () => {
    const out = advanceBlock(null, context());
    expect(out).toMatchObject({
      block: { index: 1, startedOn: START, deloadFrom: null, selections: { squat: 'a' } },
      closed: null,
      events: ['BLOCK_STARTED'],
    });
  });
});

describe('35 days is a block', () => {
  it('nothing happens before, not even a deload after 28 days', () => {
    const out = advanceBlock(
      block(),
      context({ asOf: addDays(START, 34), lastSessionDate: addDays(START, 33) }),
    );
    expect(out.events).toEqual([]);
    expect(out.block.deloadFrom).toBeNull();
    expect(out.block.index).toBe(1);
  });

  it('then the block rotates, and the variant that did not give progress moves on', () => {
    const out = advanceBlock(
      block(),
      context({ asOf: addDays(START, 35), lastSessionDate: addDays(START, 34) }),
    );
    expect(out).toMatchObject({
      block: { index: 2, selections: { squat: 'b' } },
      events: ['BLOCK_ROTATED'],
    });
    expect(out.closed).toMatchObject({ index: 1 });
  });

  it('a variant that works, or was not done enough to say, stays (T35)', () => {
    const moving = context({
      asOf: addDays(START, 35),
      evidence: () => ({ qualifiedExposures: 6, progressing: true }),
    });
    expect(advanceBlock(block(), moving).block.selections).toEqual({ squat: 'a' });
    const few = context({ asOf: addDays(START, 35), evidence: () => null });
    expect(advanceBlock(block(), few).block.selections).toEqual({ squat: 'a' });
  });

  it('the person’s own choice is taken', () => {
    const out = advanceBlock(
      block(),
      context({ asOf: addDays(START, 35), chosen: { squat: 'c' } }),
    );
    expect(out.block.selections).toEqual({ squat: 'c' });
  });
});

describe('T93, T94 the deload', () => {
  const tired = (asOf: string) =>
    context({
      asOf,
      lastSessionDate: addDays(asOf, -1),
      deload: {
        signals: ['FATIGUE_HIGH', 'RECOVERY_LOW'],
        keyExercises: [],
        daily: [],
        requested: false,
      },
    });

  it('starts when the signals ask for it, not in the first week', () => {
    expect(advanceBlock(block(), tired(addDays(START, 5))).events).toEqual([]);
    const out = advanceBlock(block(), tired(addDays(START, 10)));
    expect(out.events).toEqual(['DELOAD_REACTIVE']);
    expect(out.block).toMatchObject({
      deloadFrom: addDays(START, 10),
      deloadReason: 'DELOAD_REACTIVE',
      index: 1,
    });
  });

  it('once per block, and the block goes on after it', () => {
    const begun = block({ deloadFrom: addDays(START, 10), deloadReason: 'DELOAD_REACTIVE' });
    expect(advanceBlock(begun, tired(addDays(START, 20))).events).toEqual([]);
    expect(phaseOf(begun, addDays(START, 10))).toBe('deload');
    expect(phaseOf(begun, addDays(START, 16))).toBe('deload');
    expect(phaseOf(begun, addDays(START, 17))).toBe('work');
    expect(phaseOf(block(), START)).toBe('work');
    expect(phaseOf(begun, addDays(START, 9))).toBe('work');
  });

  it('is asked for by the person at any time', () => {
    const asked = context({
      asOf: addDays(START, 2),
      lastSessionDate: addDays(START, 1),
      deload: { signals: [], keyExercises: [], daily: [], requested: true },
    });
    expect(advanceBlock(block(), asked).events).toEqual(['DELOAD_REACTIVE']);
  });
});

describe('a break', () => {
  it('restarts the clock of the block, and no deload comes straight after it', () => {
    const away = context({
      asOf: addDays(START, 12),
      lastSessionDate: addDays(START, 2),
      deload: {
        signals: ['FATIGUE_HIGH', 'RECOVERY_LOW'],
        keyExercises: [],
        daily: [],
        requested: false,
      },
    });
    const out = advanceBlock(block(), away);
    expect(out.events).toEqual(['BLOCK_CLOCK_RESET']);
    expect(out.block).toMatchObject({ startedOn: addDays(START, 12), deloadFrom: null });
  });

  it('counts from the start of the block when nothing was done in it', () => {
    const idle = context({ asOf: addDays(START, 9), lastSessionDate: addDays(START, -3) });
    expect(advanceBlock(block(), idle).events).toEqual(['BLOCK_CLOCK_RESET']);
  });
});

describe('what can no longer be planned', () => {
  it('is replaced by the next variant of its slot', () => {
    const excluded = context({
      asOf: addDays(START, 3),
      lastSessionDate: addDays(START, 2),
      eligibility: { profile: { knee: null }, excludedIds: new Set(['a']) },
    });
    const out = advanceBlock(block(), excluded);
    expect(out.events).toEqual(['SELECTION_REPLACED']);
    expect(out).toMatchObject({ block: { selections: { squat: 'b' } }, replacedSlots: ['squat'] });
  });
});
