import { prescribesLoad } from './loadGuard';
import { fold, hasStem } from './text';
import { detectOutOfScope, type OutOfScopeTopic } from './topicGuard';

/**
 * Checks on what a model wrote, run before the app sees it. A violation
 * does not reach the person: the Worker asks once for a corrected answer
 * and, failing that, returns nothing at all (AI-INTEGRACJA I4, I5).
 *
 * They are word-level and deliberately blunt. The evaluation measures how
 * often a good answer trips one; the cost of a false alarm is one retry.
 */

/** The shape of a weekly summary, as far as these checks care. */
export interface SummaryText {
  headline: string;
  highlights: readonly string[];
  flags: readonly { code: string; comment: string }[];
  questions: readonly string[];
}

export interface SummaryFacts {
  /** The signal codes the context carried: the only ones a flag may name. */
  signals: readonly string[];
  /** Whether the history is too thin to speak of a direction. */
  sparse: boolean;
}

export type GuardViolation =
  | { kind: 'flag_not_in_signals'; code: string }
  | { kind: 'sparse_vocabulary'; word: string }
  | { kind: 'out_of_scope'; topic: OutOfScopeTopic }
  | { kind: 'medical_advice'; word: string }
  /** Free text only: a summary has no field for a load, a chat reply does not. */
  | { kind: 'load_prescription' };

/** Direction words that need history to mean anything. PLAN §6.2. */
export const SPARSE_FORBIDDEN_STEMS = ['trend', 'progres', 'stagnacj', 'adaptacj', 'regres'];

/**
 * What advice about a complaint sounds like (folded stems: no diacritics). "Rest" is absent on purpose:
 * it is also what a short-sleep comment says, and a sleep comment is fine.
 */
export const MEDICAL_ADVICE_STEMS = [
  'rozciag',
  'oklad',
  'masaz',
  'rehabilit',
  'diagnoz',
  'leczen',
  'terapi',
  'fizykoterap',
  'masc',
];

/** Every string of the summary the person will read. */
export function summaryStrings(summary: SummaryText): string[] {
  return [
    summary.headline,
    ...summary.highlights,
    ...summary.flags.map((f) => f.comment),
    ...summary.questions,
  ];
}

function wordsOf(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function checkSummary(summary: SummaryText, facts: SummaryFacts): GuardViolation[] {
  const out: GuardViolation[] = [];

  for (const flag of summary.flags) {
    if (!facts.signals.includes(flag.code))
      out.push({ kind: 'flag_not_in_signals', code: flag.code });
  }

  for (const text of summaryStrings(summary)) out.push(...checkText(text, facts.sparse));

  return dedupe(out);
}

/** The word-level checks every piece of model text must pass, whatever its shape. */
function checkText(text: string, sparse: boolean): GuardViolation[] {
  const out: GuardViolation[] = [];
  const words = wordsOf(text);

  if (sparse) {
    for (const stem of SPARSE_FORBIDDEN_STEMS) {
      if (hasStem(words, [stem])) out.push({ kind: 'sparse_vocabulary', word: stem });
    }
  }

  const topic = detectOutOfScope(text);
  if (topic !== null) out.push({ kind: 'out_of_scope', topic });

  for (const stem of MEDICAL_ADVICE_STEMS) {
    if (hasStem(words, [stem])) out.push({ kind: 'medical_advice', word: stem });
  }
  return out;
}

/**
 * The same checks for a chat reply, plus the one a summary's schema makes
 * unnecessary: no load for a future session. The reply has already been
 * shown while it streamed, so a violation means the app takes it back
 * (see src/ai/chat); there is no repair as in the weekly summary.
 */
export function checkReply(text: string, facts: { sparse: boolean }): GuardViolation[] {
  const out = checkText(text, facts.sparse);
  if (prescribesLoad(text)) out.push({ kind: 'load_prescription' });
  return dedupe(out);
}

function dedupe(violations: GuardViolation[]): GuardViolation[] {
  const seen = new Set<string>();
  return violations.filter((v) => {
    const key = JSON.stringify(v);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A short, content-free description to hand back to the model for its one repair attempt. */
export function describeViolations(violations: readonly GuardViolation[]): string {
  return violations
    .map((v) => {
      switch (v.kind) {
        case 'flag_not_in_signals':
          return `flag code ${v.code} is not in the signals`;
        case 'sparse_vocabulary':
          return `the word family "${v.word}" is not allowed while the history is sparse`;
        case 'out_of_scope':
          return `the answer touches ${v.topic}, which is out of scope`;
        case 'medical_advice':
          return `the answer gives advice about a complaint ("${v.word}")`;
        case 'load_prescription':
          return 'the answer tells the person what load, reps or band to use next';
      }
    })
    .join('; ');
}
