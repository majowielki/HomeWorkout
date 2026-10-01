import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { buildCoachContext } from '@/ai/context/buildCoachContext';
import { coachContextSchema } from '@/ai/contract/coachContext';
import { scenario } from '@/ai/testing/synthetic';

import { CATEGORIES, evalCaseSchema, type EvalCase } from '../schema';

const DIR = join(__dirname, '..', 'cases', 'weekly-summary');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

const cases: [string, EvalCase][] = files.map((file) => {
  const raw: unknown = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  return [file, evalCaseSchema.parse(raw)];
});

describe('weekly-summary evaluation cases', () => {
  it('has at least ten', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it('covers every category of AI-INTEGRACJA §5.1 that applies to the summary', () => {
    const present = new Set(cases.map(([, c]) => c.category));
    expect([...CATEGORIES].filter((category) => !present.has(category))).toEqual([]);
  });

  it('names each file after its id, and ids are unique', () => {
    expect(cases.map(([file]) => file)).toEqual(cases.map(([, c]) => `${c.id}.json`));
    expect(new Set(cases.map(([, c]) => c.id)).size).toBe(cases.length);
  });

  it('puts the cheap safety scorers on every case', () => {
    for (const [, c] of cases) {
      expect(c.expect.scorers).toEqual(
        expect.arrayContaining(['schemaValid', 'noLoads', 'numbersFaithful', 'outOfScope']),
      );
    }
  });

  it('applies the sparse-vocabulary scorer exactly where the history is sparse', () => {
    for (const [, c] of cases) {
      expect(c.expect.scorers.includes('sparseVocabulary')).toBe(
        c.expect.signals.includes('SPARSE_HISTORY'),
      );
    }
  });

  describe.each(cases)('%s', (_file, c) => {
    const built = () => {
      const { context, omissions } = buildCoachContext(scenario(c.scenario));
      return { context, omissions };
    };

    it('is a context the contract accepts, with the signals the case expects', () => {
      const { context } = built();
      expect(coachContextSchema.safeParse(context).success).toBe(true);
      expect(context.signals).toEqual(c.expect.signals);
    });

    it('is held to the gate the case describes', () => {
      const { context, omissions } = built();
      expect(context.notes).toHaveLength(c.expect.notesKept);
      expect(omissions).toEqual(c.expect.omissions);
    });

    it('asks the model for a referral sentence only when it is shown a complaint', () => {
      const asked = (c.expect.requireSentences ?? []).length > 0;
      expect(asked).toBe(c.category === 'guardrail_layer2');
    });
  });
});
