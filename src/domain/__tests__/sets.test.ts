/**
 * Engine v2, P3 (12 §5, T76-T80): how many sets an exposure gets, and how
 * many it may.
 */
import { defaultPreferences } from '../preferences/preferences';
import { recommendSets, type SetsInput } from '../plan/sets';

const input = (patch: Partial<SetsInput> = {}): SetsInput => ({
  kind: 'compound',
  primaryMuscles: ['quads'],
  phase: 'work',
  room: { dayRoom: {}, weekRoom: {} },
  ...patch,
});

describe('the sets the policy recommends', () => {
  it('compound 3, accessory 2, core 2, filler 2', () => {
    for (const [kind, sets] of [
      ['compound', 3],
      ['accessory', 2],
      ['core', 2],
      ['filler', 2],
    ] as const) {
      expect(recommendSets(input({ kind }))).toEqual({
        recommended: sets,
        allowed: [1, 6],
        advisable: [1, 10],
        reasons: ['POLICY_DEFAULT'],
      });
    }
  });
});

describe('T76 a deload keeps half of the sets, and at least one', () => {
  it('3 → 2, 2 → 1', () => {
    expect(recommendSets(input({ phase: 'deload' })).recommended).toBe(2);
    expect(recommendSets(input({ kind: 'core', phase: 'deload' })).recommended).toBe(1);
    expect(recommendSets(input({ phase: 'deload' })).reasons).toEqual([
      'POLICY_DEFAULT',
      'PHASE_DELOAD',
    ]);
  });

  it('a lighter day is one set of everything', () => {
    const r = recommendSets(input({ lighterDay: true }));
    expect(r.recommended).toBe(1);
    expect(r.allowed).toEqual([1, 6]);
    expect(r.reasons).toContain('LIGHTER_DAY');
  });
});

describe('T77 the room of the day and the week is the limit', () => {
  it('the day', () => {
    const r = recommendSets(input({ room: { dayRoom: { quads: 2 }, weekRoom: {} } }));
    expect(r).toMatchObject({ recommended: 2, allowed: [1, 2] });
    expect(r.reasons).toContain('DAY_ROOM');
  });

  it('the week', () => {
    const r = recommendSets(input({ room: { dayRoom: {}, weekRoom: { quads: 1 } } }));
    expect(r).toMatchObject({ recommended: 1, allowed: [1, 1] });
    expect(r.reasons).toContain('WEEK_ROOM');
  });

  it('the muscle with the least room decides, and a half set is not a set', () => {
    const r = recommendSets(
      input({
        primaryMuscles: ['quads', 'glutes'],
        room: { dayRoom: { quads: 3, glutes: 2.5 }, weekRoom: { quads: 5 } },
      }),
    );
    expect(r.allowed).toEqual([1, 2]);
  });

  it('room that is not binding is not a reason', () => {
    const r = recommendSets(input({ room: { dayRoom: { quads: 4 }, weekRoom: { quads: 6 } } }));
    expect(r.reasons).toEqual(['POLICY_DEFAULT']);
  });

  it('the time', () => {
    const r = recommendSets(
      input({ room: { dayRoom: {}, weekRoom: {}, fitsTime: (n) => n <= 2 } }),
    );
    expect(r).toMatchObject({ recommended: 2, allowed: [1, 2] });
    expect(r.reasons).toContain('TIME');
  });

  it('what the planner may plan is never more than the limit of the planner', () => {
    expect(
      recommendSets(input({ room: { dayRoom: { quads: 99 }, weekRoom: {} } })).allowed,
    ).toEqual([1, 6]);
  });
});

describe('T78 no room is not a recommendation of zero sets that looks like one', () => {
  it('says there is none, and what could still be done with advice', () => {
    const r = recommendSets(input({ room: { dayRoom: { quads: 0 }, weekRoom: {} } }));
    expect(r).toEqual({
      recommended: 0,
      allowed: null,
      advisable: [1, 10],
      reasons: ['POLICY_DEFAULT', 'DAY_ROOM', 'NO_ROOM'],
    });
  });

  it('no time for even one set', () => {
    const r = recommendSets(input({ room: { dayRoom: {}, weekRoom: {}, fitsTime: () => false } }));
    expect(r).toMatchObject({ recommended: 0, allowed: null });
    expect(r.reasons).toContain('TIME');
  });
});

describe('T79, T80 the person’s own number', () => {
  const fixed = (byKind: Record<string, number>) => ({
    ...defaultPreferences(),
    setsPerExposure: { mode: 'fixed' as const, byKind },
  });

  it('is taken as it is when it fits', () => {
    const r = recommendSets(input({ preferences: fixed({ compound: 4 }) }));
    expect(r).toMatchObject({ recommended: 4, allowed: [1, 6], reasons: ['USER_FIXED'] });
  });

  it('does not decide a kind it says nothing about', () => {
    expect(
      recommendSets(input({ kind: 'core', preferences: fixed({ compound: 4 }) })).reasons,
    ).toEqual(['POLICY_DEFAULT']);
  });

  it('gives way to the room', () => {
    const r = recommendSets(
      input({ preferences: fixed({ compound: 5 }), room: { dayRoom: { quads: 3 }, weekRoom: {} } }),
    );
    expect(r.recommended).toBe(3);
  });

  it('is the engine’s when the person chose the engine', () => {
    expect(recommendSets(input({ preferences: defaultPreferences() })).recommended).toBe(3);
  });
});
