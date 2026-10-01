import { toJSONSchema, type z } from 'zod';

import { buildCoachContext } from '../../context/buildCoachContext';
import { scenario } from '../../testing/synthetic';
import { coachContextSchema, loadSchema } from '../coachContext';
import { CONTRACT_VERSION } from '../versions';
import {
  type WeeklySummary,
  weeklySummaryRequestSchema,
  weeklySummarySchema,
} from '../weeklySummary';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/* Compile-time: the exported type is exactly what the schema infers. */
const _summary: Equal<WeeklySummary, z.infer<typeof weeklySummarySchema>> = true;
void _summary;

const context = () =>
  buildCoachContext(scenario({ weight: { startKg: 96, perWeekKg: -0.6 } })).context;

const goodSummary: WeeklySummary = {
  headline: 'Trzymasz ciężary przy spadającej wadze.',
  highlights: ['Dziewięć sesji w cztery tygodnie.'],
  flags: [{ code: 'SPARSE_HISTORY', comment: 'Zbieramy dopiero dane.' }],
  questions: ['Jak spało się w tym tygodniu?'],
};

describe('coachContextSchema', () => {
  it('accepts what the builder produces', () => {
    expect(coachContextSchema.safeParse(context()).success).toBe(true);
  });

  it('rejects an unknown field at any depth', () => {
    const withExtraTop = { ...context(), diagnosis: 'x' };
    expect(coachContextSchema.safeParse(withExtraTop).success).toBe(false);

    const c = context();
    const nested = { ...c, recovery: { ...c.recovery, medication: 'x' } };
    expect(coachContextSchema.safeParse(nested).success).toBe(false);
  });

  it('rejects a signal code it does not know', () => {
    expect(coachContextSchema.safeParse({ ...context(), signals: ['FATIGUE_HIGH'] }).success).toBe(
      false,
    );
  });

  it('rejects a band position outside the four marks', () => {
    expect(loadSchema.safeParse({ kind: 'band', bandId: 'red', position: 4 }).success).toBe(false);
    expect(loadSchema.safeParse({ kind: 'band', bandId: 'red', position: 3 }).success).toBe(true);
  });

  it('rejects a note longer than the cap', () => {
    const c = context();
    const long = { ...c, notes: [{ date: c.asOf, source: 'daily', text: 'a'.repeat(281) }] };
    expect(coachContextSchema.safeParse(long).success).toBe(false);
  });
});

describe('weeklySummarySchema (what the model returns)', () => {
  it('accepts a well-formed summary', () => {
    expect(weeklySummarySchema.safeParse(goodSummary).success).toBe(true);
  });

  it('has no field a load could go into (I1)', () => {
    expect(Object.keys(weeklySummarySchema.shape).sort()).toEqual([
      'flags',
      'headline',
      'highlights',
      'questions',
    ]);
  });

  it('only lets a flag name a signal code', () => {
    const bad = { ...goodSummary, flags: [{ code: 'WEIGHT_PLATEAU', comment: 'x' }] };
    expect(weeklySummarySchema.safeParse(bad).success).toBe(false);
  });

  it.each([
    ['empty headline', { headline: '' }],
    ['no highlights', { highlights: [] }],
    ['five highlights', { highlights: ['a', 'b', 'c', 'd', 'e'] }],
    ['three questions', { questions: ['a', 'b', 'c'] }],
    [
      'six flags',
      { flags: Array.from({ length: 6 }, () => ({ code: 'SPARSE_HISTORY', comment: 'x' })) },
    ],
    ['an overlong highlight', { highlights: ['a'.repeat(281)] }],
  ])('enforces its bounds after parsing: %s', (_name, patch) => {
    expect(weeklySummarySchema.safeParse({ ...goodSummary, ...patch }).success).toBe(false);
  });

  it('is expressible as JSON Schema without constants (the providers cope with enums, not always with const)', () => {
    const json = JSON.stringify(toJSONSchema(weeklySummarySchema));
    expect(json).not.toContain('"const"');
    expect(json).not.toContain('"anyOf"');
  });
});

describe('weeklySummaryRequestSchema', () => {
  const request = () => ({
    contractVersion: CONTRACT_VERSION,
    requestId: '0b8b6a52-5a1e-4a3e-9d0f-8f6f3b1c2d4e',
    context: context(),
  });

  it('accepts a request at the current contract version', () => {
    expect(weeklySummaryRequestSchema.safeParse(request()).success).toBe(true);
  });

  it('rejects another contract version', () => {
    expect(
      weeklySummaryRequestSchema.safeParse({ ...request(), contractVersion: CONTRACT_VERSION + 1 })
        .success,
    ).toBe(false);
  });

  it('rejects an unknown top-level field', () => {
    expect(weeklySummaryRequestSchema.safeParse({ ...request(), userId: 'x' }).success).toBe(false);
  });

  it('rejects a missing or too-short request id', () => {
    expect(weeklySummaryRequestSchema.safeParse({ ...request(), requestId: 'short' }).success).toBe(
      false,
    );
  });
});
