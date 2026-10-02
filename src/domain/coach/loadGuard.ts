import { fold, hasStem } from './text';

/**
 * Whether a text tells the person what load to use in a future session
 * (AI-INTEGRACJA I1). In the weekly summary the schema has no field a load
 * could go in; free text has no such protection, so the chat and the
 * evaluation both ask this question of what a model wrote.
 *
 * A sentence counts when it both urges something ("zwiększ", "spróbuj",
 * "powinieneś", "w następnym tygodniu") and names a load ("kg", "serii",
 * "guma", "hantle"). Stating what was logged is fine; telling the person
 * what to do next is the rules engine's job.
 *
 * It is blunt on purpose. A false alarm costs one withheld answer, and the
 * evaluation measures how often a good answer trips it.
 */

/** Stems of folded words that urge an action or point at the future. */
export const PRESCRIBING_STEMS = [
  'zwieksz',
  'doloz',
  'zrob',
  'sprobuj',
  'celuj',
  'ustaw',
  'wybierz',
  'uzyj',
  'polecam',
  'powinien',
  'powinn',
  'nastepnym',
  'przyszlym',
];

/** Stems of folded words that name a load or a volume. */
export const LOAD_STEMS = [
  'kg',
  'kilogram',
  'powtorz',
  'serii',
  'serie',
  'seria',
  'guma',
  'gume',
  'gumy',
  'pozycj',
  'hantl',
  'ciezar',
  'obciaz',
];

const tokens = (sentence: string) =>
  fold(sentence)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

export function prescribesLoad(text: string): boolean {
  return text.split(/[.!?;\n]+/).some((sentence) => {
    const words = tokens(sentence);
    const looksAhead = hasStem(words, PRESCRIBING_STEMS) || /za tydzien/.test(fold(sentence));
    return looksAhead && hasStem(words, LOAD_STEMS);
  });
}
