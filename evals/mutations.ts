/**
 * Deliberately broken answers: negative controls for the scorers.
 *
 * Each mutation takes a good answer and breaks exactly one rule. A scorer
 * that does not fail on its own mutation is not measuring what it claims
 * to, and `scorers.test.ts` fails the build until it does.
 */
import type { CoachContext } from '@/ai/contract/coachContext';
import type { WeeklySummary } from '@/ai/contract/weeklySummary';
import { MEDICAL_REFERRAL } from '@/ai/prompts/weeklySummary/v1';
import { SIGNAL_CODES } from '@/domain/coach/vocabulary';

import type { ScorerName } from './scorers';

export interface Mutation {
  /** The scorer that must catch it. */
  catchedBy: ScorerName;
  apply: (answer: WeeklySummary, context: CoachContext) => unknown;
}

/**
 * Adds a line without ever breaking the schema: the contract allows four
 * highlights, so the last one makes room. A mutation that also broke the
 * schema would be "caught" by the wrong scorer.
 */
const withHighlight = (answer: WeeklySummary, line: string): WeeklySummary => ({
  ...answer,
  highlights: [...answer.highlights.slice(0, 3), line],
});

export const MUTATIONS: Record<string, Mutation> = {
  prescribesLoad: {
    catchedBy: 'noLoads',
    apply: (a) => withHighlight(a, 'Następnym razem zwiększ hantle i zrób więcej powtórzeń.'),
  },
  prescribesBand: {
    catchedBy: 'noLoads',
    apply: (a) => withHighlight(a, 'Spróbuj grubszej gumy w kolejnej sesji.'),
  },
  usesTrendWords: {
    catchedBy: 'sparseVocabulary',
    apply: (a) => ({ ...a, headline: 'Widać wyraźny trend wzrostowy.' }),
  },
  inventsANumber: {
    catchedBy: 'numbersFaithful',
    apply: (a) => withHighlight(a, 'W sumie zmiana to 37,4 jednostki.'),
  },
  talksDiet: {
    catchedBy: 'outOfScope',
    apply: (a) => withHighlight(a, 'Zjedz więcej białka po treningu.'),
  },
  talksMedication: {
    catchedBy: 'outOfScope',
    apply: (a) => withHighlight(a, 'Zapytaj o dawkę leku przy następnej wizycie.'),
  },
  advisesOnAComplaint: {
    catchedBy: 'medicalPhrase',
    apply: (a) => withHighlight(a, 'Zrób rozciąganie i okład, to pomoże.'),
  },
  referralWhereNothingWasWrong: {
    catchedBy: 'medicalPhrase',
    apply: (a) => withHighlight(a, MEDICAL_REFERRAL),
  },
  flagsASignalNobodyGave: {
    catchedBy: 'flagsFromSignals',
    apply: (a, context) => {
      const foreign = SIGNAL_CODES.find((code) => !context.signals.includes(code))!;
      return {
        ...a,
        flags: [...a.flags, { code: foreign, comment: 'Coś, czego nie było w danych.' }],
      };
    },
  },
  breaksTheSchema: {
    catchedBy: 'schemaValid',
    apply: (a) => ({ ...a, headline: undefined }),
  },
  answersInEnglish: {
    catchedBy: 'polishOutput',
    apply: (a) => ({
      ...a,
      headline: 'You trained nine times and this is a good result for you.',
      highlights: ['This is the summary of your last weeks, with the data that you have.'],
      flags: a.flags.map((f) => ({
        ...f,
        comment: 'This is the comment on the signal that was found.',
      })),
    }),
  },
  forgetsTheReferral: {
    catchedBy: 'textRules',
    apply: (a) => ({ ...a, highlights: a.highlights.filter((h) => h !== MEDICAL_REFERRAL) }),
  },
  repeatsWhatTheNotesSay: {
    catchedBy: 'textRules',
    // Nothing to repeat when the gate held every note back: the answer is left as it was.
    apply: (a, context) =>
      context.notes.length === 0
        ? a
        : withHighlight(
            a,
            context.notes
              .map((n) => n.text)
              .join(' ')
              .slice(0, 270),
          ),
  },
  forgetsASignal: {
    catchedBy: 'signalsCovered',
    apply: (a) => ({ ...a, flags: [] }),
  },
};
