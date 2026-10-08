/**
 * Engine v2, P1 (07 P1.3, T16, T39, T85): results with provenance — which
 * combinations are a real report and which are a contradiction.
 */
import {
  actualQuantitySchema,
  observed,
  setDispositionSchema,
  setObservationSchema,
} from '../observations/types';
import { z } from 'zod';
import { legalObservation } from './planV2Fixtures';

const parses = (candidate: unknown) => setObservationSchema.safeParse(candidate).success;
const messages = (candidate: unknown) => {
  const result = setObservationSchema.safeParse(candidate);
  return result.success ? [] : result.error.issues.map((i) => i.message).join('|');
};

const reps = z.number().int();
const field = observed(reps);
const base = {
  value: 12,
  origin: 'user_reported' as const,
  channel: 'touch' as const,
  confirmedAt: '2026-10-09T08:00:00.000Z',
  presentedDefault: false,
  confirmation: 'edited' as const,
};

describe('a result with provenance', () => {
  it('T16 accepts the planned value confirmed as it was shown, without an edit', () => {
    const confirmed = legalObservation();
    expect(setObservationSchema.parse(confirmed)).toEqual(confirmed);
    expect(confirmed.amount.origin).toBe('user_confirmed');
    expect(confirmed.amount.presentedDefault).toBe(true);
  });

  it.each([
    ['typed by the person', base],
    [
      'a default the person saw highlighted and confirmed',
      { ...base, origin: 'user_confirmed', presentedDefault: true, confirmation: 'visible' },
    ],
    [
      'a default read back by the voice reply (T85)',
      {
        ...base,
        origin: 'user_confirmed',
        channel: 'voice',
        presentedDefault: true,
        confirmation: 'read_back',
      },
    ],
    [
      'a default saved in silent mode, never shown (T85)',
      {
        ...base,
        origin: 'user_confirmed',
        channel: 'voice',
        presentedDefault: true,
        confirmation: 'none',
      },
    ],
    [
      'a value spoken by the person, with no read-back (T39)',
      { ...base, channel: 'voice', confirmation: 'none' },
    ],
    ['a value spoken and read back', { ...base, channel: 'voice', confirmation: 'read_back' }],
    [
      'a measurement',
      { ...base, origin: 'measured', channel: 'sensor', confirmedAt: null, confirmation: 'none' },
    ],
    [
      'an old record of unknown provenance',
      {
        ...base,
        value: null,
        origin: 'legacy_unknown',
        channel: 'legacy',
        confirmedAt: null,
        confirmation: 'none',
      },
    ],
    ['a value the person chose not to give', { ...base, value: null }],
  ])('accepts %s', (_, candidate) => {
    expect(field.safeParse(candidate).success).toBe(true);
  });

  it.each([
    [
      'a measurement that did not come from a sensor',
      { ...base, origin: 'measured', confirmation: 'none' },
    ],
    ['a sensor reading nobody measured', { ...base, channel: 'sensor' }],
    [
      'a measurement with no value',
      { ...base, value: null, origin: 'measured', channel: 'sensor', confirmation: 'none' },
    ],
    [
      'unknown provenance from the touchscreen',
      { ...base, origin: 'legacy_unknown', confirmation: 'none' },
    ],
    [
      'an unchanged suggestion presented as reported',
      { ...base, presentedDefault: true, confirmation: 'visible' },
    ],
    [
      'an edited value that is also the unchanged default',
      { ...base, origin: 'user_confirmed', presentedDefault: true },
    ],
    ['an edited value that is only confirmed', { ...base, origin: 'user_confirmed' }],
    [
      'a confirmation of a value that was not the suggestion',
      { ...base, origin: 'user_confirmed', confirmation: 'visible' },
    ],
    ['a field with a provenance missing', { value: 12 }],
    ['an unknown confirmation', { ...base, confirmation: 'maybe' }],
  ])('refuses %s', (_, candidate) => {
    expect(field.safeParse(candidate).success).toBe(false);
  });
});

describe('a recorded set', () => {
  it('T39 keeps the provenance of every field apart: reps spoken, the rest untouched', () => {
    const spoken = legalObservation({
      amount: {
        value: { kind: 'reps', reps: 10 },
        origin: 'user_reported',
        channel: 'voice',
        confirmedAt: '2026-10-09T08:00:00.000Z',
        presentedDefault: false,
        confirmation: 'read_back',
      },
      rir: {
        value: null,
        origin: 'user_confirmed',
        channel: 'voice',
        confirmedAt: null,
        presentedDefault: true,
        confirmation: 'none',
      },
    });
    const parsed = setObservationSchema.parse(spoken);
    expect(parsed.amount.channel).toBe('voice');
    expect(parsed.rir.confirmation).toBe('none');
    expect(parsed.resistance.confirmation).toBe('visible');
  });

  it('accepts a set beyond the plan, with no id of a planned set', () => {
    expect(
      parses(
        legalObservation({
          plannedSetId: null,
          logicalSetId: null,
          exposureId: 's1/r1/e1',
          side: null,
        }),
      ),
    ).toBe(true);
    expect(
      parses(legalObservation({ plannedSetId: null, logicalSetId: null, exposureId: null })),
    ).toBe(true);
  });

  it('accepts an interrupted set with part of the work, or with none', () => {
    const none = legalObservation({
      status: 'interrupted',
      amount: { ...legalObservation().amount, value: { kind: 'reps', reps: 0 } },
    });
    expect(parses(none)).toBe(true);
    expect(parses({ ...none, amount: { ...none.amount, value: { kind: 'reps', reps: 4 } } })).toBe(
      true,
    );
  });

  it('accepts durations and distances', () => {
    expect(actualQuantitySchema.safeParse({ kind: 'duration', seconds: 31.5 }).success).toBe(true);
    expect(actualQuantitySchema.safeParse({ kind: 'distance', meters: 400 }).success).toBe(true);
    const timed = legalObservation({
      amount: { ...legalObservation().amount, value: { kind: 'duration', seconds: 30 } },
    });
    expect(parses(timed)).toBe(true);
    const run = legalObservation({
      amount: { ...legalObservation().amount, value: { kind: 'distance', meters: 100 } },
    });
    expect(parses(run)).toBe(true);
  });

  it('refuses a performed set with nothing in it — that is an attempt, not a set', () => {
    const zero = (value: unknown) =>
      legalObservation({ amount: { ...legalObservation().amount, value } as never });
    expect(messages(zero({ kind: 'reps', reps: 0 }))).toContain(
      'a performed set has something in it',
    );
    expect(messages(zero({ kind: 'duration', seconds: 0 }))).toContain('has something in it');
    expect(messages(zero({ kind: 'distance', meters: 0 }))).toContain('has something in it');
    expect(messages(zero(null))).toContain('has something in it');
  });

  it('refuses a planned set outside an exposure, and a logical set outside the plan', () => {
    expect(messages(legalObservation({ exposureId: null }))).toContain('belongs to an exposure');
    expect(messages(legalObservation({ plannedSetId: null }))).toContain('no logical set');
  });

  it.each([
    ['a fraction of a rep', { kind: 'reps', reps: 1.5 }],
    ['a negative number of reps', { kind: 'reps', reps: -1 }],
    ['infinite seconds', { kind: 'duration', seconds: Infinity }],
    ['a made-up measure', { kind: 'pace', minPerKm: 5 }],
  ])('refuses %s', (_, quantity) => {
    expect(actualQuantitySchema.safeParse(quantity).success).toBe(false);
  });

  it.each([
    ['an RIR of -1', { rir: { ...legalObservation().rir, value: -1 } }],
    ['a fractional RIR', { rir: { ...legalObservation().rir, value: 1.5 } }],
    ['a revision of zero', { revision: 0 }],
    ['a shortfall nobody knows', { shortfall: 'bored' }],
    ['a status of "pending"', { status: 'pending' }],
    ['an unknown field', { surprise: true }],
    ['an empty command id', { commandId: '' }],
  ])('refuses %s', (_, patch) => {
    expect(parses({ ...legalObservation(), ...patch })).toBe(false);
  });

  it('records why a set fell short, as the person said', () => {
    for (const shortfall of ['doms', 'short_rest', 'technique', 'pain'] as const) {
      expect(parses(legalObservation({ shortfall }))).toBe(true);
    }
  });
});

describe('what happened to an expected set', () => {
  const disposition = {
    plannedSetId: 's1/r1/e1/2R',
    status: 'skipped',
    reason: 'user_skipped',
    commandId: 'cmd-9',
    at: '2026-10-09T08:10:00.000Z',
  };

  it('T12 keeps a skip, with its reason, as a fact of its own', () => {
    expect(setDispositionSchema.parse(disposition)).toEqual(disposition);
    expect(
      setDispositionSchema.safeParse({ ...disposition, status: 'pending', reason: null }).success,
    ).toBe(true);
    expect(
      setDispositionSchema.safeParse({ ...disposition, status: 'interrupted', reason: null })
        .success,
    ).toBe(true);
  });

  it('refuses a skip with no reason, and a reason on something that was not skipped', () => {
    expect(setDispositionSchema.safeParse({ ...disposition, reason: null }).success).toBe(false);
    expect(setDispositionSchema.safeParse({ ...disposition, status: 'performed' }).success).toBe(
      false,
    );
    expect(setDispositionSchema.safeParse({ ...disposition, reason: 'felt like it' }).success).toBe(
      false,
    );
  });
});
