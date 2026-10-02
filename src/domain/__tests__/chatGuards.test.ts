import { LOAD_STEMS, PRESCRIBING_STEMS, prescribesLoad } from '../coach/loadGuard';
import { checkReply } from '../coach/outputGuards';

describe('prescribesLoad', () => {
  it.each([
    'Następnym razem zwiększ hantle i zrób więcej powtórzeń.',
    'Spróbuj grubszej gumy w kolejnej sesji.',
    'Powinieneś podnieść ciężar do 14 kg.',
    'W przyszłym tygodniu celuj w 3 serie po 12.',
    'Za tydzień weź hantle po 12 kg.',
    'Polecam gumę na pozycji 2.',
    'Dobrze. Ustaw hantle na 10 kg.',
  ])('flags advice about what to lift next: %s', (text) => {
    expect(prescribesLoad(text)).toBe(true);
  });

  it.each([
    'Ostatnio wiosłowanie szło z hantlami po 10 kg, bez zmian.',
    'W tym tygodniu masz 6 serii na plecy.',
    'Aplikacja zdecyduje, jaki ciężar wziąć w następnej sesji.',
    'Zwiększ sen, jeśli możesz.',
    'Zrobiłeś trzy sesje w tym tygodniu.',
    '',
  ])('leaves a description of the past, or advice that names no load, alone: %s', (text) => {
    expect(prescribesLoad(text)).toBe(false);
  });

  it.each([
    'Zrobiłeś 6 serii na plecy w tym tygodniu.',
    'W ostatniej sesji zrobiłeś po 14 powtórzeń z hantlem 14 kg.',
    'Zwiększyłeś ciężar z 12 do 14 kg w ostatnich tygodniach.',
    'Dołożyłaś gumę o jedną pozycję.',
    'Ustawiłeś hantle na 12 kg i zrobiliście trzy serie.',
    'Wybrałeś cięższą gumę i wzrosła liczba powtórzeń.',
  ])('does not read the past tense as advice: %s', (text) => {
    expect(prescribesLoad(text)).toBe(false);
  });

  it.each([
    'Zrób 3 serie po 12 powtórzeń.',
    'Zrobisz 12 powtórzeń z hantlem 14 kg.',
    'Warto zrobić więcej serii.',
    'Zwiększ ciężar do 16 kg.',
    'Dołóż jeszcze 2 kg do hantli.',
    'Ustaw gumę na pozycji 2.',
    'Zrobiłbyś więcej serii z cięższym hantlem.',
  ])('still reads an instruction, the future and the infinitive as advice: %s', (text) => {
    expect(prescribesLoad(text)).toBe(true);
  });

  it('judges a sentence at a time, so two innocent sentences do not add up', () => {
    expect(prescribesLoad('Powinieneś odpocząć. Hantle po 10 kg leżą w kącie.')).toBe(false);
  });

  it('lists the stems it works from, folded', () => {
    for (const stem of [...PRESCRIBING_STEMS, ...LOAD_STEMS]) {
      expect(stem).toBe(stem.toLowerCase());
      expect(stem).toMatch(/^[a-z0-9]+$/);
    }
  });
});

describe('checkReply', () => {
  const facts = { sparse: false };

  it('passes an in-scope reply that quotes what was logged', () => {
    expect(
      checkReply('Wiosłowanie: ostatnia sesja z hantlami po 10 kg, wynik utrzymany.', facts),
    ).toEqual([]);
  });

  it('applies the checks every model text gets', () => {
    expect(checkReply('Zjedz więcej białka po treningu.', facts)).toEqual([
      { kind: 'out_of_scope', topic: 'diet' },
    ]);
    expect(checkReply('Zrób rozciąganie i okład.', facts).map((v) => v.kind)).toEqual([
      'medical_advice',
      'medical_advice',
    ]);
  });

  it('refuses trend vocabulary only while the history is thin', () => {
    expect(checkReply('Widać trend wzrostowy.', { sparse: true })).toEqual([
      { kind: 'sparse_vocabulary', word: 'trend' },
    ]);
    expect(checkReply('Widać trend wzrostowy.', facts)).toEqual([]);
  });

  it('adds the check a summary does not need: no load for a future session', () => {
    expect(checkReply('Następnym razem zwiększ hantle do 14 kg.', facts)).toEqual([
      { kind: 'load_prescription' },
    ]);
  });

  it('reports each kind of violation once, however often it occurs', () => {
    const text = 'Zwiększ hantle. Spróbuj gumy. Trend jest świetny.';
    const kinds = checkReply(text, { sparse: true }).map((v) => v.kind);
    expect(kinds).toEqual(['sparse_vocabulary', 'load_prescription']);
  });
});
