import {
  checkSummary,
  describeViolations,
  MEDICAL_ADVICE_STEMS,
  SPARSE_FORBIDDEN_STEMS,
  summaryStrings,
  type SummaryFacts,
  type SummaryText,
} from '../coach/outputGuards';
import { fold } from '../coach/text';

const facts = (patch: Partial<SummaryFacts> = {}): SummaryFacts => ({
  signals: [],
  sparse: false,
  ...patch,
});

const summary = (patch: Partial<SummaryText> = {}): SummaryText => ({
  headline: 'Dziewięć sesji w cztery tygodnie.',
  highlights: ['Przysiad goblet: 10 kg, bez zmian.'],
  flags: [],
  questions: [],
  ...patch,
});

describe('checkSummary', () => {
  it('passes a plain, in-scope summary', () => {
    expect(checkSummary(summary(), facts())).toEqual([]);
  });

  describe('flags', () => {
    it('may only name a signal the context carried', () => {
      const flagged = summary({ flags: [{ code: 'LAYOFF_SHORT', comment: 'Krótka przerwa.' }] });
      expect(checkSummary(flagged, facts({ signals: ['LAYOFF_SHORT'] }))).toEqual([]);
      expect(checkSummary(flagged, facts({ signals: ['SPARSE_HISTORY'] }))).toEqual([
        { kind: 'flag_not_in_signals', code: 'LAYOFF_SHORT' },
      ]);
    });
  });

  describe('sparse vocabulary', () => {
    it.each([
      'trend wagi',
      'Trendy',
      'brak progresu',
      'adaptacja organizmu',
      'stagnacja',
      'regres',
    ])('is refused on thin data: %s', (headline) => {
      const violations = checkSummary(summary({ headline }), facts({ sparse: true }));
      expect(violations.map((v) => v.kind)).toEqual(['sparse_vocabulary']);
    });

    it('is allowed once there is history', () => {
      expect(checkSummary(summary({ headline: 'Trend wagi: stabilny.' }), facts())).toEqual([]);
    });

    it('looks at every string the person reads', () => {
      const hidden = summary({
        highlights: ['Dobrze.', 'Progres widoczny.'],
        flags: [{ code: 'SPARSE_HISTORY', comment: 'Za wcześnie na trend.' }],
        questions: ['Czy widzisz regres?'],
      });
      const words = checkSummary(hidden, facts({ sparse: true, signals: ['SPARSE_HISTORY'] }))
        .filter((v) => v.kind === 'sparse_vocabulary')
        .map((v) => (v.kind === 'sparse_vocabulary' ? v.word : ''));
      expect(new Set(words)).toEqual(new Set(['trend', 'progres', 'regres']));
    });

    it('lists the stems the prompt forbids', () => {
      expect(SPARSE_FORBIDDEN_STEMS).toEqual([
        'trend',
        'progres',
        'stagnacj',
        'adaptacj',
        'regres',
      ]);
    });
  });

  describe('out of scope', () => {
    it('refuses diet talk', () => {
      const violations = checkSummary(summary({ highlights: ['Zjedz więcej białka.'] }), facts());
      expect(violations).toEqual([{ kind: 'out_of_scope', topic: 'diet' }]);
    });

    it('refuses medication talk', () => {
      const violations = checkSummary(
        summary({ questions: ['Czy zmieniałeś dawkę leku?'] }),
        facts(),
      );
      expect(violations).toEqual([{ kind: 'out_of_scope', topic: 'medication' }]);
    });
  });

  describe('medical advice', () => {
    it.each(['Zrób rozciąganie.', 'Zastosuj okład.', 'Polecam masaż.', 'Potrzebna rehabilitacja.'])(
      'refuses: %s',
      (highlight) => {
        const violations = checkSummary(summary({ highlights: [highlight] }), facts());
        expect(violations.map((v) => v.kind)).toEqual(['medical_advice']);
      },
    );

    it('lets the fixed referral sentence through', () => {
      const referral = summary({
        highlights: ['Dolegliwości omów z fizjoterapeutą lub lekarzem.'],
      });
      expect(checkSummary(referral, facts())).toEqual([]);
    });

    it('does not mind a comment about sleep and rest', () => {
      const sleep = summary({ highlights: ['Krótki sen: daj sobie dziś czas na odpoczynek.'] });
      expect(checkSummary(sleep, facts())).toEqual([]);
    });

    it('has folded stems, so diacritics in the answer do not hide anything', () => {
      expect(MEDICAL_ADVICE_STEMS.every((stem) => stem === fold(stem))).toBe(true);
      expect(
        checkSummary(summary({ highlights: ['ROZCIĄGANIE przed snem.'] }), facts()).length,
      ).toBe(1);
    });
  });

  it('reports each distinct violation once, however often it occurs', () => {
    const repeated = summary({
      headline: 'Trend.',
      highlights: ['Trend.', 'Trend znowu.'],
    });
    expect(checkSummary(repeated, facts({ sparse: true }))).toEqual([
      { kind: 'sparse_vocabulary', word: 'trend' },
    ]);
  });
});

describe('summaryStrings', () => {
  it('collects the headline, highlights, flag comments and questions', () => {
    const strings = summaryStrings(
      summary({
        highlights: ['a', 'b'],
        flags: [{ code: 'X', comment: 'c' }],
        questions: ['d'],
      }),
    );
    expect(strings).toEqual(['Dziewięć sesji w cztery tygodnie.', 'a', 'b', 'c', 'd']);
  });
});

describe('describeViolations', () => {
  it('gives the model content-free feedback for its one retry', () => {
    const text = describeViolations([
      { kind: 'flag_not_in_signals', code: 'LAYOFF_LONG' },
      { kind: 'sparse_vocabulary', word: 'trend' },
      { kind: 'out_of_scope', topic: 'diet' },
      { kind: 'medical_advice', word: 'masaz' },
    ]);
    expect(text).toBe(
      'flag code LAYOFF_LONG is not in the signals; ' +
        'the word family "trend" is not allowed while the history is sparse; ' +
        'the answer touches diet, which is out of scope; ' +
        'the answer gives advice about a complaint ("masaz")',
    );
  });

  it('is empty for no violations', () => {
    expect(describeViolations([])).toBe('');
  });
});
