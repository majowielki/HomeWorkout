import { effortOf } from '../observations/effort';
import {
  buildObservation,
  defaultEffort,
  FALLBACK_EFFORT_RIR,
  readBackText,
  transcriptStillApplies,
  type EntryContext,
  type SetEntry,
} from '../observations/entry';
import { setObservationSchema } from '../observations/types';
import { FOUR_KG, legalObservation } from './planFixtures';

const AT = '2026-10-09T08:00:00.000Z';
const reps = (n: number) => ({ kind: 'reps' as const, reps: n });
const entry = (patch: Partial<SetEntry> = {}): SetEntry => ({
  status: 'performed',
  amount: { value: reps(12), edited: false },
  resistance: { value: FOUR_KG, edited: false },
  rir: { value: 2, edited: false },
  ...patch,
});
const ctx = (patch: Partial<EntryContext> = {}): EntryContext => ({
  channel: 'touch',
  at: AT,
  shown: { amount: 'visible', resistance: 'visible', rir: 'visible' },
  ...patch,
});
/** What the store would add to make a full record, to check the schema takes the result. */
const whole = (o: ReturnType<typeof buildObservation>) =>
  setObservationSchema.safeParse({ ...legalObservation(), ...o });

describe('P5.4: the logger turns what the person did into a result with its provenance', () => {
  it('T38 a tap and a spoken "as planned" make the same kind of record, differing only in the channel', () => {
    const touch = buildObservation(entry(), ctx());
    const voice = buildObservation(
      entry(),
      ctx({
        channel: 'voice',
        shown: { amount: 'read_back', resistance: 'visible', rir: 'read_back' },
      }),
    );
    expect(whole(touch).success).toBe(true);
    expect(whole(voice).success).toBe(true);
    expect(touch.amount).toMatchObject({
      origin: 'user_confirmed',
      presentedDefault: true,
      confirmation: 'visible',
      channel: 'touch',
    });
    expect(voice.amount).toMatchObject({ confirmation: 'read_back', channel: 'voice' });
    expect({ ...voice.amount, channel: 'touch', confirmation: 'visible' }).toEqual(touch.amount);
    expect(touch.performedAt).toBe(AT);
  });

  it('T39 the reps said aloud are reported; effort and weight that were not said keep their own provenance', () => {
    const spoken = buildObservation(
      entry({ amount: { value: reps(10), edited: true } }),
      ctx({
        channel: 'voice',
        shown: { rir: 'read_back', resistance: 'visible' },
      }),
    );
    expect(whole(spoken).success).toBe(true);
    expect(spoken.amount).toMatchObject({
      origin: 'user_reported',
      presentedDefault: false,
      confirmation: 'edited',
      channel: 'voice',
    });
    expect(spoken.rir).toMatchObject({
      origin: 'user_confirmed',
      confirmation: 'read_back',
      value: 2,
    });
    expect(spoken.resistance).toMatchObject({ origin: 'user_confirmed', confirmation: 'visible' });
    expect(effortOf({ ...legalObservation(), ...spoken })).toBe(2);
  });

  it('a suggestion saved without having been shown is no evidence of effort', () => {
    const silent = buildObservation(entry(), ctx({ channel: 'voice', shown: {} }));
    expect(whole(silent).success).toBe(true);
    expect(silent.rir).toMatchObject({ confirmation: 'none', presentedDefault: true });
    expect(effortOf({ ...legalObservation(), ...silent })).toBeNull();
    // What the person said is theirs even when nothing was read back.
    const said = buildObservation(
      entry({ rir: { value: 1, edited: true } }),
      ctx({ channel: 'voice', shown: {} }),
    );
    expect(effortOf({ ...legalObservation(), ...said })).toBe(1);
  });

  it('an effort nobody gave and nothing suggested is claimed as nothing', () => {
    const none = buildObservation(entry({ rir: { value: null, edited: false } }), ctx());
    expect(whole(none).success).toBe(true);
    expect(none.rir).toMatchObject({ value: null, confirmation: 'none', presentedDefault: false });
    expect(effortOf({ ...legalObservation(), ...none })).toBeNull();
  });

  it('keeps the status, the shortfall and the time the set was done', () => {
    const stopped = buildObservation(
      entry({ status: 'interrupted', shortfall: 'pain', amount: { value: reps(3), edited: true } }),
      ctx({ performedAt: '2026-10-09T07:59:00.000Z' }),
    );
    expect(stopped).toMatchObject({
      status: 'interrupted',
      shortfall: 'pain',
      performedAt: '2026-10-09T07:59:00.000Z',
    });
    expect(whole(stopped).success).toBe(true);
    expect(buildObservation(entry(), ctx()).shortfall).toBeNull();
  });

  it('the suggested effort follows the last set, then the target, then "hard"', () => {
    const last = legalObservation({ rir: { ...legalObservation().rir, value: 3 } });
    expect(defaultEffort(last, { min: 1, max: 2 })).toBe(3);
    expect(defaultEffort(null, { min: 1, max: 2 })).toBe(1);
    expect(defaultEffort(undefined, null)).toBe(FALLBACK_EFFORT_RIR);
    const unknown = legalObservation({ rir: { ...legalObservation().rir, value: null } });
    expect(defaultEffort(unknown, { min: 4, max: 5 })).toBe(4);
  });

  it('the voice reply reads the amount and the effort aloud', () => {
    expect(readBackText(entry())).toBe('Zapisuję 12, ciężko');
    expect(readBackText(entry({ rir: { value: 0, edited: true } }))).toBe('Zapisuję 12, na maksa');
    expect(readBackText(entry({ rir: { value: 4, edited: true } }))).toBe('Zapisuję 12, lekko');
    expect(readBackText(entry({ rir: { value: 7, edited: true } }))).toBe('Zapisuję 12, zapas 7');
    expect(readBackText(entry({ rir: { value: null, edited: false } }))).toBe('Zapisuję 12');
    expect(
      readBackText(entry({ amount: { value: { kind: 'duration', seconds: 40 }, edited: true } })),
    ).toBe('Zapisuję 40 sekund, ciężko');
    expect(
      readBackText(entry({ amount: { value: { kind: 'distance', meters: 100 }, edited: true } })),
    ).toBe('Zapisuję 100 m, ciężko');
  });
});

describe('P5.4 T40: a late transcript is for the set it was started for', () => {
  const started = { sessionId: 's1', planRevision: 1, plannedSetId: 's1/r1/e1/1' };
  it('applies while nothing has moved', () => {
    expect(transcriptStillApplies(started, { ...started })).toBe(true);
    expect(
      transcriptStillApplies(
        { ...started, plannedSetId: null },
        { ...started, plannedSetId: null },
      ),
    ).toBe(true);
  });
  it.each([
    ['another set', { plannedSetId: 's1/r1/e1/2' }],
    ['the next exercise', { plannedSetId: 's1/r1/e2/1' }],
    ['a session command heard on a set', { plannedSetId: null }],
    ['a new plan revision', { planRevision: 2 }],
    ['another session', { sessionId: 's2' }],
  ])('does not apply after %s', (_, patch) => {
    expect(transcriptStillApplies(started, { ...started, ...patch })).toBe(false);
  });
});
