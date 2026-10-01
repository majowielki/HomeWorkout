const FOLDED: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

/**
 * Lowercase and strip Polish diacritics. People type notes on a phone
 * keyboard, often without them ("kluje w kolanie"), so every detector
 * compares folded text and never needs to list both spellings.
 */
export function fold(text: string): string {
  return text.toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => FOLDED[c]!);
}

/** Words that open a new thought; "zakwasy w łydkach, ale kolano boli" is two claims. */
const CLAUSE_BREAKS = new Set(['ale', 'jednak', 'natomiast', 'lecz']);

/**
 * Folded text split into clauses of word tokens. Detectors judge one
 * clause at a time so that a body part in one thought is not paired with a
 * pain word in another.
 */
export function clauses(text: string): string[][] {
  const out: string[][] = [];
  for (const segment of fold(text).split(/[.,;:!?()\n]+/)) {
    let current: string[] = [];
    for (const token of segment.split(/[^a-z0-9]+/)) {
      if (token === '') continue;
      if (CLAUSE_BREAKS.has(token)) {
        if (current.length > 0) out.push(current);
        current = [];
      } else {
        current.push(token);
      }
    }
    if (current.length > 0) out.push(current);
  }
  return out;
}

/** Whether some token starts with one of the stems. */
export function hasStem(tokens: readonly string[], stems: readonly string[]): boolean {
  return tokens.some((token) => stems.some((stem) => token.startsWith(stem)));
}
