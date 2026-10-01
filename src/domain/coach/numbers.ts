import { fold } from './text';

/**
 * Finding the numbers in a piece of Polish text, to check that every one of
 * them came from the data (AI-INTEGRACJA I6, research R9).
 *
 * Digits are read as they are written, with a comma or a point as the
 * decimal separator; a range ("8-12") and a date ("2026-10-01") simply yield
 * their parts. Spelled-out cardinals from two upward are read too, in the
 * forms that turn up beside a noun ("dwa", "dwóch", "dziewięciu"). "Jeden",
 * "jedna" and "jedno" are left alone: they are as often an article or a
 * pronoun as a count, and flagging them would only teach people to ignore
 * the check.
 */

/** Folded stems and forms of the cardinals. Exact words, so "sto" does not match "stoi". */
const WORDS: Record<string, number> = {
  dwa: 2,
  dwie: 2,
  dwoch: 2,
  dwiema: 2,
  trzy: 3,
  trzech: 3,
  trzem: 3,
  cztery: 4,
  czterech: 4,
  czterem: 4,
  piec: 5,
  pieciu: 5,
  szesc: 6,
  szesciu: 6,
  siedem: 7,
  siedmiu: 7,
  osiem: 8,
  osmiu: 8,
  dziewiec: 9,
  dziewieciu: 9,
  dziesiec: 10,
  dziesieciu: 10,
  jedenascie: 11,
  jedenastu: 11,
  dwanascie: 12,
  dwunastu: 12,
  trzynascie: 13,
  trzynastu: 13,
  czternascie: 14,
  czternastu: 14,
  pietnascie: 15,
  pietnastu: 15,
  szesnascie: 16,
  szesnastu: 16,
  siedemnascie: 17,
  siedemnastu: 17,
  osiemnascie: 18,
  osiemnastu: 18,
  dziewietnascie: 19,
  dziewietnastu: 19,
  dwadziescia: 20,
  dwudziestu: 20,
  trzydziesci: 30,
  trzydziestu: 30,
  czterdziesci: 40,
  czterdziestu: 40,
  piecdziesiat: 50,
  piecdziesieciu: 50,
  szescdziesiat: 60,
  siedemdziesiat: 70,
  osiemdziesiat: 80,
  dziewiecdziesiat: 90,
  sto: 100,
};

const DIGITS = /\d+(?:[.,]\d+)?/g;

/** Both separators read as a decimal point; rounded so 94.5 and 94,5 are one number. */
function normalise(raw: string): number {
  return Math.round(Number(raw.replace(',', '.')) * 1e6) / 1e6;
}

/** Every number in the text, in order of appearance, without sign. */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(DIGITS)) out.push(normalise(match[0]));
  for (const word of fold(text).split(/[^a-z0-9]+/)) {
    const value = WORDS[word];
    if (value !== undefined) out.push(value);
  }
  return out;
}

/** Every number in a JSON-like value: numbers as they are, numbers inside strings as written. */
export function numbersIn(value: unknown, into: Set<number> = new Set()): Set<number> {
  if (typeof value === 'number') {
    into.add(Math.round(Math.abs(value) * 1e6) / 1e6);
  } else if (typeof value === 'string') {
    for (const n of extractNumbers(value)) into.add(n);
  } else if (Array.isArray(value)) {
    for (const item of value) numbersIn(item, into);
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) numbersIn(item, into);
  }
  return into;
}

/** The numbers in `texts` that are not in `allowed`, each once, in order of first appearance. */
export function unfaithfulNumbers(
  texts: readonly string[],
  allowed: ReadonlySet<number>,
): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const text of texts) {
    for (const n of extractNumbers(text)) {
      if (!allowed.has(n) && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  }
  return out;
}
