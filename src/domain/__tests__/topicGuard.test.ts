import { detectOutOfScope } from '../coach/topicGuard';

describe('detectOutOfScope', () => {
  it('finds nothing in ordinary training talk', () => {
    expect(detectOutOfScope('')).toBeNull();
    expect(detectOutOfScope('dziś 25 minut, tylko gumy')).toBeNull();
    expect(detectOutOfScope('lekki trening, wyciskanie poszło dobrze')).toBeNull();
  });

  describe('diet', () => {
    it.each([
      'ile kalorii spalę na rowerze?',
      'ile białka powinienem jeść',
      'zmieniłem dietę',
      'nie mam apetytu od tygodnia',
      'jem mniej niż zwykle',
      'przerwa w jedzeniu przed treningiem',
      'biorę kreatynę',
      'post przerywany',
      'jadłem tylko jeden posiłek',
      'ile węglowodanów dziś',
      'czy 1500 kcal wystarczy',
    ])('flags: %s', (text) => {
      expect(detectOutOfScope(text)).toBe('diet');
    });
  });

  describe('medication', () => {
    it.each([
      'czy zwiększyć dawkę mounjaro?',
      'zwiększyłem dawkę',
      'dziś zastrzyk, trening po południu',
      'tirzepatyd mnie osłabia',
      'biorę leki na ciśnienie',
      'kiedy kolejna dawka',
      'wstrzyknąłem w niedzielę',
    ])('flags: %s', (text) => {
      expect(detectOutOfScope(text)).toBe('medication');
    });

    it('wins over diet in the same text', () => {
      expect(detectOutOfScope('ile kalorii po zastrzyku')).toBe('medication');
      expect(detectOutOfScope('dieta. mounjaro.')).toBe('medication');
    });
  });

  describe('doses', () => {
    it('are a training word when the clause talks about training', () => {
      expect(detectOutOfScope('dawka bodźca treningowego za mała')).toBeNull();
      expect(detectOutOfScope('dobra dawka serii na plecy')).toBeNull();
    });

    it('are the drug otherwise', () => {
      expect(detectOutOfScope('dawkowanie')).toBe('medication');
    });
  });

  it('does not mistake "lekki" or "lekarz" for a drug', () => {
    expect(detectOutOfScope('lekki dzień')).toBeNull();
    expect(detectOutOfScope('lekarz kazał oszczędzać kolano')).toBeNull();
  });
});
