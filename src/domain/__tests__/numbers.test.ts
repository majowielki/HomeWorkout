import { extractNumbers, numbersIn, unfaithfulNumbers } from '../coach/numbers';

describe('extractNumbers', () => {
  it('reads digits, with either decimal separator', () => {
    expect(extractNumbers('Waga 94,5 kg, wcześniej 95.2 kg.')).toEqual([94.5, 95.2]);
    expect(extractNumbers('12 powtórzeń')).toEqual([12]);
  });

  it('reads both ends of a range', () => {
    expect(extractNumbers('zakres 8-12 powtórzeń')).toEqual([8, 12]);
    expect(extractNumbers('od 10 do 15')).toEqual([10, 15]);
  });

  it('splits a date into its parts', () => {
    expect(extractNumbers('od 2026-10-01')).toEqual([2026, 10, 1]);
  });

  it('ignores the sign: -0,6 and 0,6 are the same number', () => {
    expect(extractNumbers('spadek -0,6 kg')).toEqual([0.6]);
  });

  it('treats 94.5 and 94,5 as one number', () => {
    expect(extractNumbers('94.5')).toEqual(extractNumbers('94,5'));
  });

  it('reads spelled-out numbers, inflected', () => {
    expect(extractNumbers('dwa razy, dwie serie, u dwóch osób')).toEqual([2, 2, 2]);
    expect(extractNumbers('dziewięć sesji w cztery tygodnie')).toEqual([9, 4]);
    expect(extractNumbers('Zakwasy w pięciu partiach, trzech ćwiczeniach')).toEqual([5, 3]);
    expect(extractNumbers('dwadzieścia, trzydzieści, sto')).toEqual([20, 30, 100]);
    expect(extractNumbers('piętnaście i osiemnastu')).toEqual([15, 18]);
  });

  it('is not fooled by words that merely begin like a number', () => {
    expect(extractNumbers('stoi stopa stół pięknie dwoje')).toEqual([]);
  });

  it('leaves "jeden" alone: it is as often an article as a count', () => {
    expect(extractNumbers('jeden z ważnych sygnałów, jedna sesja, jedno ćwiczenie')).toEqual([]);
  });

  it('mixes digits and words in order of kind', () => {
    expect(extractNumbers('9 sesji, czyli dziewięć')).toEqual([9, 9]);
  });

  it('finds nothing in text without numbers', () => {
    expect(extractNumbers('')).toEqual([]);
    expect(extractNumbers('Dobry tydzień.')).toEqual([]);
  });
});

describe('numbersIn', () => {
  it('collects numbers at any depth, without sign', () => {
    const value = {
      a: 1,
      b: [2.5, { c: -3 }],
      d: 'zakres 8-12, 94,5 kg',
      e: null,
      f: true,
    };
    expect([...numbersIn(value)].sort((x, y) => x - y)).toEqual([1, 2.5, 3, 8, 12, 94.5]);
  });

  it('reads numbers inside date strings', () => {
    expect([...numbersIn({ asOf: '2026-10-01' })].sort((x, y) => x - y)).toEqual([1, 10, 2026]);
  });

  it('adds to a set it is given', () => {
    const into = new Set([42]);
    expect(numbersIn([7], into)).toBe(into);
    expect([...into].sort((x, y) => x - y)).toEqual([7, 42]);
  });
});

describe('unfaithfulNumbers', () => {
  const allowed = new Set([9, 94.5, 12]);

  it('is empty when every number came from the data', () => {
    expect(unfaithfulNumbers(['9 sesji, waga 94,5 kg'], allowed)).toEqual([]);
    expect(unfaithfulNumbers(['dziewięć sesji'], allowed)).toEqual([]);
  });

  it('reports a number that was not handed over, once', () => {
    expect(unfaithfulNumbers(['Schudłeś 2,4 kg', 'czyli 2,4 kg w miesiąc'], allowed)).toEqual([
      2.4,
    ]);
  });

  it('catches arithmetic: a sum nobody gave', () => {
    expect(unfaithfulNumbers(['9 sesji i 12 serii, razem 21 jednostek'], allowed)).toEqual([21]);
  });

  it('catches a rounded figure', () => {
    expect(unfaithfulNumbers(['waga około 95 kg'], allowed)).toEqual([95]);
  });

  it('reads across several strings', () => {
    expect(unfaithfulNumbers(['9', '77', '12', '3'], allowed)).toEqual([77, 3]);
  });
});
