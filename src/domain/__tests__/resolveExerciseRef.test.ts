/** P4b.1, T70: authored vocabulary, honest ambiguity, and no guessed exercise. */
import exercisesJson from '@data/exercises.json';
import termsJson from '@data/movement-terms.json';
import { movementLexiconSchema } from '@data/movement-terms.schema';
import {
  createExerciseResolver,
  normalizeExerciseName,
  resolveExerciseRef,
  type MovementLexicon,
} from '../catalog/resolve';
import type { Exercise } from '../types';

const TERMS = movementLexiconSchema.parse(termsJson);
const CATALOG = Object.fromEntries((exercisesJson.exercises as Exercise[]).map((e) => [e.id, e]));
const resolve = createExerciseResolver(CATALOG, TERMS);
const named = (id: string, name: string, aliases?: string[], archived?: boolean) => ({
  id,
  name,
  aliases,
  archived,
});
const small = (entries: ReturnType<typeof named>[], lexicon: MovementLexicon = TERMS) =>
  createExerciseResolver(Object.fromEntries(entries.map((e) => [e.id, e])), lexicon);

describe('T70 references and exact authored names', () => {
  it('resolves an id before considering words, without a prototype fallback', () => {
    expect(resolveExerciseRef({ id: 'plank' }, CATALOG, TERMS)).toMatchObject({
      kind: 'exercise',
      exerciseId: 'plank',
      matchedBy: 'id',
      catalogStatus: 'active',
    });
    expect(resolve({ id: '__proto__' })).toEqual({
      kind: 'not_found',
      query: '__proto__',
      nearest: [],
      movement: null,
    });
    expect(resolve({ id: 'constructor' }).kind).toBe('not_found');
  });

  it('normalizes punctuation, whitespace, case and composed/decomposed Polish letters', () => {
    expect(normalizeExerciseName('  ŁÓDŹ – ĆWICZENIE!  ')).toBe('lodz cwiczenie');
    expect(resolve({ query: '  DESKA! ' })).toMatchObject({
      exerciseId: 'plank',
      matchedBy: 'name',
    });
    expect(resolve({ query: 'WYCISKANIE SIEDZĄC' })).toMatchObject({
      exerciseId: 'seated-db-shoulder-press',
      matchedBy: 'alias',
    });
  });

  it('gives an exact name precedence over another entry’s alias', () => {
    const r = small([named('a', 'Deska'), named('b', 'Inne', ['deska'])]);
    expect(r({ query: 'deska' })).toMatchObject({ exerciseId: 'a', matchedBy: 'name' });
  });

  it('does not confuse identification with medical eligibility or preference', () => {
    expect(resolve({ id: 'archer-push-up' })).toMatchObject({
      kind: 'exercise',
      exerciseId: 'archer-push-up',
    });
  });

  it('never identifies an archived entry or offers it as a nearest name', () => {
    const r = small([
      named('a', 'Wycofane wyciskanie', ['stare'], true),
      named('b', 'Wiosłowanie'),
    ]);
    expect(r({ id: 'a' })).toEqual({ kind: 'not_found', query: 'a', nearest: [], movement: null });
    expect(r({ query: 'stare' })).toMatchObject({ kind: 'not_found', nearest: [] });
  });

  it('resolves every shipped name and alias back to its author', () => {
    for (const e of Object.values(CATALOG)) {
      expect(resolve({ query: e.name })).toMatchObject({ exerciseId: e.id, matchedBy: 'name' });
      for (const alias of e.aliases ?? [])
        expect(resolve({ query: alias })).toMatchObject({ kind: 'exercise', exerciseId: e.id });
    }
  });
});

describe('T70 Polish inflections and bounded typos', () => {
  it.each([
    ['czy mogę dorzucić wyciskania siedząco', 'seated-db-shoulder-press'],
    ['wiosłowaniem hantlami w opadzie', 'db-bent-over-row'],
    ['uginania młotkowego', 'hammer-curl'],
    ['wyciskanif siedząc', 'seated-db-shoulder-press'],
    ['wyciskaniet siedząc', 'seated-db-shoulder-press'],
    ['wyciskani siedząc', 'seated-db-shoulder-press'],
    ['Supermam', 'superman'],
    ['krzesełło', 'wall-sit'],
  ])('%s', (query, exerciseId) => {
    expect(resolve({ query })).toMatchObject({ kind: 'exercise', exerciseId });
  });

  it('does not guess a short word or two mistakes in a long one', () => {
    const r = small([named('a', 'Wyciskanie'), named('b', 'Deska')]);
    expect(r({ query: 'deskz' }).kind).toBe('not_found');
    expect(r({ query: 'wyciXXanie' }).kind).toBe('not_found');
  });

  it('leaves a spelling with two possible canonical corrections unresolved', () => {
    const lexicon = {
      ...TERMS,
      terms: [
        { canonical: 'abcdef', forms: ['abcdef'] },
        { canonical: 'abcdeg', forms: ['abcdeg'] },
      ],
      phrases: [],
      movements: [],
      qualifierGroups: [],
    };
    const r = small([named('a', 'abcdef'), named('b', 'abcdeg')], lexicon);
    expect(r({ query: 'abcdeh' }).kind).toBe('not_found');
  });
});

describe('T70 ambiguity and nearest alternatives', () => {
  it('accepts a unique sufficiently similar name and reports the name as its source', () => {
    const r = small([named('a', 'Pompka klasyczna na macie'), named('b', 'Wiosłowanie')]);
    expect(r({ query: 'pompka klasyczna' })).toMatchObject({
      kind: 'exercise',
      exerciseId: 'a',
      matchedBy: 'name',
    });
  });

  it('accepts a unique sufficiently similar alias and reports that source', () => {
    const r = small([named('a', 'Ruch A', ['pompka klasyczna na macie'])]);
    expect(r({ query: 'pompka klasyczna na macie dodatkowa' })).toMatchObject({
      kind: 'exercise',
      exerciseId: 'a',
      matchedBy: 'alias',
    });
  });

  it('accepts the score threshold itself but leaves a lower score unknown', () => {
    const r = small([named('a', 'alfa beta gamma delta epsilon')]);
    expect(r({ query: 'alfa beta gamma' })).toMatchObject({ kind: 'exercise', exerciseId: 'a' });
    expect(r({ query: 'alfa beta' }).kind).toBe('not_found');
  });

  it('treats a label made entirely of stop words as zero evidence, without dividing by zero', () => {
    expect(small([named('a', 'ćwiczenie')])({ query: 'czy mogę' })).toEqual({
      kind: 'not_found',
      query: 'czy mogę',
      nearest: [],
      movement: null,
    });
  });

  it('asks about duplicate names or aliases, ordered by id', () => {
    const r = small([named('b', 'Deska', ['podpór']), named('a', 'Deska', ['podpór'])]);
    expect(r({ query: 'deska' })).toEqual({
      kind: 'ambiguous',
      candidates: [
        { exerciseId: 'a', name: 'Deska' },
        { exerciseId: 'b', name: 'Deska' },
      ],
    });
    expect(r({ query: 'podpór' }).kind).toBe('ambiguous');
    expect(r({ query: 'desce' }).kind).toBe('ambiguous');
  });

  it('asks about equally likely inflected aliases', () => {
    const r = small([
      named('a', 'Ćwiczenie A', ['przysiady']),
      named('b', 'Ćwiczenie B', ['przysiad']),
    ]);
    expect(r({ query: 'przysiadem' }).kind).toBe('ambiguous');
  });

  it('asks for the variant of a generic overhead press instead of picking the first', () => {
    const r = small([
      named('b', 'Wyciskanie hantli nad głowę stojąc'),
      named('a', 'Wyciskanie hantli nad głowę siedząc'),
    ]);
    expect(r({ query: 'wyciskanie hantli nad głowę' })).toMatchObject({
      kind: 'ambiguous',
      candidates: [{ exerciseId: 'a' }, { exerciseId: 'b' }],
    });
  });

  it('never translates a behind-neck press into an overhead press or triceps extension', () => {
    const result = resolve({ query: 'wyciskanie hantli zza głowy' });
    expect(result).toMatchObject({
      kind: 'not_found',
      movement: { id: 'push-vertical', muscles: ['shoulders', 'triceps'] },
    });
    if (result.kind !== 'not_found') throw new Error('Must remain unknown');
    expect(result.nearest).toHaveLength(3);
  });

  it('keeps an explicit equipment, position or side even when dropping it would make a perfect match', () => {
    const r = small([
      named('a', 'Pompki', ['pompka']),
      named('b', 'Wyciskanie hantli nad głowę stojąc'),
    ]);
    expect(r({ query: 'pompki z gumą' }).kind).toBe('not_found');
    expect(r({ query: 'wyciskanie hantli nad głowę siedząc' }).kind).toBe('not_found');
    expect(r({ query: 'pompki jednorącz' }).kind).toBe('not_found');
  });

  it('does not offer unrelated nearest names for an empty, stop-word-only or unknown query', () => {
    for (const query of ['', '!?', 'czy mogę dorzucić', 'asdfqwerty']) {
      expect(resolve({ query })).toEqual({ kind: 'not_found', query, movement: null, nearest: [] });
    }
    expect(small([])({ query: 'wiosłowanie' })).toMatchObject({
      kind: 'not_found',
      nearest: [],
      movement: { id: 'row' },
    });
  });

  it('does not depend on the order of catalogue records', () => {
    const reverse = createExerciseResolver(
      Object.fromEntries(Object.entries(CATALOG).reverse()),
      TERMS,
    );
    for (const query of [
      'wyciskanie hantli nad głowę',
      'wyciskanie hantli zza głowy',
      'nieznane wiosłowanie',
      'wiosłowaniem hantlami w opadzie',
    ]) {
      expect(reverse({ query })).toEqual(resolve({ query }));
    }
  });
});
