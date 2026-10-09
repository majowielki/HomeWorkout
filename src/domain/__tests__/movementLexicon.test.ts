import termsJson from '@data/movement-terms.json';
import { movementLexiconSchema } from '@data/movement-terms.schema';

describe('the authored movement lexicon', () => {
  it('accepts the shipped data', () => {
    expect(movementLexiconSchema.safeParse(termsJson).success).toBe(true);
  });
  it.each([
    { version: 0 },
    { terms: [{ canonical: 'foo', forms: ['!'] }] },
    {
      terms: [
        { canonical: 'a', forms: ['ten sam'] },
        { canonical: 'b', forms: ['TEN-SAM'] },
      ],
    },
    {
      terms: [
        { canonical: 'a', forms: ['x'] },
        { canonical: 'a', forms: ['y'] },
      ],
    },
    { qualifierGroups: [['nieznany']] },
    {
      terms: [
        { canonical: 'a', forms: ['x'] },
        { canonical: 'b', forms: ['a'] },
      ],
    },
    { movements: [{ id: 'x', allOf: ['nieznany'], anyOf: [], muscles: ['core'] }] },
    { movements: [termsJson.movements[0], termsJson.movements[0]] },
  ])('rejects inconsistent lexicon data: %j', (patch) => {
    expect(movementLexiconSchema.safeParse({ ...termsJson, ...patch }).success).toBe(false);
  });
});
