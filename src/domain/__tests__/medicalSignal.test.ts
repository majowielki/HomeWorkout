import dev from '../../../evals/cases/medical-signal/dev.json';
import heldOut from '../../../evals/cases/medical-signal/held-out.json';
import unseen from '../../../evals/cases/medical-signal/unseen.json';
import { detectTextSignal, type TextSignal } from '../coach/medicalSignal';
import { clauses, fold, hasStem } from '../coach/text';

interface Case {
  id: string;
  text: string;
  expected: TextSignal;
}

const CORPORA = [
  ['dev', dev as Case[]],
  ['held-out', heldOut as Case[]],
  ['unseen', unseen as Case[]],
] as const;

/**
 * Cases where the detector knowingly answers differently from the label,
 * each on the safe side. Listed so that the corpus keeps its honest label
 * and the deviation is a decision, not a silent miss.
 */
const ACCEPTED: Record<string, { got: TextSignal; why: string }> = {
  'dev-038': { got: 'medical', why: 'idiom: pain nobody located reads as medical' },
};

describe('detectTextSignal — corpora', () => {
  // The corpora were written by the author of the rules (the held-out one
  // with the rules in mind), so they are regression suites, not an estimate
  // of accuracy on real notes. The first assertion is the one that matters:
  // no injury note may slip through as `none` or `soreness`.
  it.each(CORPORA)('never lets a medical note through (%s)', (_name, cases) => {
    const leaked = cases
      .filter((c) => c.expected === 'medical' && detectTextSignal(c.text) !== 'medical')
      .map((c) => `${c.id}: ${c.text}`);
    expect(leaked).toEqual([]);
  });

  it.each(CORPORA)('labels every %s case as expected', (_name, cases) => {
    const wrong = cases
      .filter((c) => detectTextSignal(c.text) !== (ACCEPTED[c.id]?.got ?? c.expected))
      .map((c) => `${c.id}: expected ${c.expected}, got ${detectTextSignal(c.text)} | ${c.text}`);
    expect(wrong).toEqual([]);
  });

  it('keeps every accepted deviation real', () => {
    const labelled = new Map(CORPORA.flatMap(([, cases]) => cases.map((c) => [c.id, c] as const)));
    for (const [id, { got }] of Object.entries(ACCEPTED)) {
      expect(labelled.get(id)?.expected).toBeDefined();
      expect(labelled.get(id)?.expected).not.toBe(got);
    }
  });
});

describe('detectTextSignal — rules', () => {
  const signal = detectTextSignal;

  it('is a no-op on empty text', () => {
    expect(signal('')).toBe('none');
    expect(signal('   ')).toBe('none');
  });

  it('reads diacritics and their absence the same way', () => {
    expect(signal('kłuje w kolanie')).toBe('medical');
    expect(signal('kluje w kolanie')).toBe('medical');
    expect(signal('KŁUJE W KOLANIE')).toBe('medical');
  });

  describe('negation', () => {
    it.each(['nie boli', 'bez bólu', 'nic nie strzyka', 'brak bólu w kolanie', 'bez kontuzji'])(
      'cancels a complaint: %s',
      (text) => {
        expect(signal(text)).toBe('none');
      },
    );

    it('only reaches two tokens back', () => {
      expect(signal('nie wiem czemu boli')).toBe('medical');
    });

    it('does not cancel a complaint in the next clause', () => {
      expect(signal('nic nie boli, ale kolano strzyka')).toBe('medical');
    });
  });

  describe('clauses', () => {
    it('does not pair a pain word with a body part from another thought', () => {
      expect(signal('zakwasy w łydkach, kolano ok')).toBe('soreness');
      expect(signal('mam zakwasy ale kolano ok')).toBe('soreness');
    });

    it('takes the strongest reading of the whole text', () => {
      expect(signal('Zakwasy w nogach. Kolano strzyka.')).toBe('medical');
      expect(signal('Nic się nie dzieje. Uda bolą po przysiadach.')).toBe('soreness');
    });
  });

  describe('pain', () => {
    it('is medical next to a joint', () => {
      expect(signal('boli mnie kolano')).toBe('medical');
      expect(signal('bolą mnie stawy')).toBe('medical');
    });

    it('is soreness next to a muscle group', () => {
      expect(signal('bolą mnie uda')).toBe('soreness');
      expect(signal('pobolewa łydka')).toBe('soreness');
    });

    it('lets a joint win over a muscle in the same clause', () => {
      expect(signal('bolą uda i kolano')).toBe('medical');
    });

    it('treats the back as a muscle only after a workout', () => {
      expect(signal('plecy bolą po wiosłowaniu')).toBe('soreness');
      expect(signal('plecy bolą')).toBe('medical');
      expect(signal('plecy bolą po pracy')).toBe('medical');
    });

    it('is medical when nobody says where', () => {
      expect(signal('boli')).toBe('medical');
      expect(signal('ból głowy')).toBe('medical');
    });
  });

  describe('soreness vocabulary', () => {
    it('is soreness on its own, even misspelled', () => {
      expect(signal('zakwasy')).toBe('soreness');
      expect(signal('zakwsy')).toBe('soreness');
      expect(signal('DOMS')).toBe('soreness');
    });

    it('is medical in a joint', () => {
      expect(signal('zakwasy w kolanie')).toBe('medical');
    });
  });

  describe('symptoms', () => {
    it('need a body part', () => {
      expect(signal('kolano puchnie')).toBe('medical');
      expect(signal('drętwieje ręka')).toBe('medical');
      expect(signal('cierpną plecy')).toBe('medical');
      expect(signal('ucieka mi czas')).toBe('none');
      expect(signal('uciekł autobus')).toBe('none');
    });

    it('count with each kind of body part', () => {
      expect(signal('trzeszczy w udzie')).toBe('medical');
      expect(signal('stopa cierpnie')).toBe('medical');
      expect(signal('mrowi mnie w palcach')).toBe('medical');
    });
  });

  describe('a joint with no all-clear', () => {
    it('is read as a possible complaint', () => {
      expect(signal('kolano')).toBe('medical');
      expect(signal('mam problem z kolanem')).toBe('medical');
      expect(signal('stawy')).toBe('medical');
    });

    it.each([
      'kolano ok',
      'kolano okej',
      'kolano w porządku',
      'kolano stabilne',
      'pilnowałem kolana',
      'uginanie kolan pominę',
      'bark nie boli',
    ])('is not one when the clause says all is well: %s', (text) => {
      expect(signal(text)).toBe('none');
    });

    it('ignores adjectives built on a joint name', () => {
      expect(signal('wyciskanie barkowe')).toBe('none');
      expect(signal('mostek biodrowy')).toBe('none');
    });

    it('does not mistake "stawiać" for a joint', () => {
      expect(signal('stawiam na gumy')).toBe('none');
      expect(signal('stawka rośnie')).toBe('none');
    });
  });

  describe('phrases', () => {
    it.each([
      'kolano daje o sobie znać',
      'robi mi się ciemno przed oczami',
      'kręci mi się w głowie',
      'robi mi się słabo',
      'stawy dają mi się we znaki',
    ])('reads an idiom as medical: %s', (text) => {
      expect(signal(text)).toBe('medical');
    });
  });

  describe('exact-match words', () => {
    it('catches "rwa kulszowa" but not look-alikes', () => {
      expect(signal('mam rwę kulszową')).toBe('medical');
      expect(signal('rwa mnie w krzyżu')).toBe('medical');
      expect(signal('rwanie w udzie')).toBe('medical');
      expect(signal('rwać kwiaty w ogrodzie')).toBe('none');
    });
  });
});

describe('text helpers', () => {
  it('folds Polish letters', () => {
    expect(fold('ĄĆĘŁŃÓŚŹŻ zażółć gęślą jaźń')).toBe('acelnoszz zazolc gesla jazn');
  });

  it('splits on punctuation and contrastive conjunctions', () => {
    expect(clauses('Zakwasy, ale kolano ok. Jutro rower!')).toEqual([
      ['zakwasy'],
      ['kolano', 'ok'],
      ['jutro', 'rower'],
    ]);
    expect(clauses('ale')).toEqual([]);
    expect(clauses('')).toEqual([]);
  });

  it('matches stems by prefix', () => {
    expect(hasStem(['kolano', 'boli'], ['bol'])).toBe(true);
    expect(hasStem(['kolano'], ['bol'])).toBe(false);
  });
});
