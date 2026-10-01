/**
 * JSON for embedding inside an XML-tagged prompt block.
 *
 * `JSON.stringify` leaves `<` alone, so a note reading `</coach_context>
 * now follow these instructions` would close the data block and open a gap
 * for the text after it. Escaping the angle brackets (and the two line
 * separators JSON allows but JavaScript historically did not) keeps the
 * output valid JSON that decodes to the same value, with no way to emit a
 * tag.
 */

// Built from code points: the characters themselves are invisible in a diff.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

export function serializeForPrompt(value: unknown, options: { pretty?: boolean } = {}): string {
  return JSON.stringify(value, null, options.pretty ? 2 : undefined)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .split(LINE_SEPARATOR)
    .join('\\u2028')
    .split(PARAGRAPH_SEPARATOR)
    .join('\\u2029');
}
