/**
 * Whether a reply shows the person the machinery behind it: a tag from the
 * instructions, or a field of the facts block.
 *
 * Found by the first run of the chat on a phone: asked what was trained
 * lately, the model began its answer with the raw `<session_facts>` block
 * from its own instructions, JSON and all, and then answered in Polish.
 * Nothing in it was a forbidden word, so no other check noticed. It is the
 * person's own data, but it is not a reply, and it can only mean the model is
 * reciting its instructions.
 *
 * A tag is a word between angle brackets; ordinary text has none. The field
 * names are the ones of the facts block and of the context.
 */
const TAG = /<\/?[a-z][a-z_]{2,}[^>]*>/i;
const FIELD = /session_?facts|historicalSessionCount|\bconstraints"\s*:|\bsignals"\s*:/i;

export function leaksInternals(text: string): boolean {
  return TAG.test(text) || FIELD.test(text);
}
