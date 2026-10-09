import { type IntentContext, matchSessionIntent } from '../voice/sessionIntent';

const on: IntentContext = { exposureId: 'e1', offer: false };
const between: IntentContext = { exposureId: null, offer: false };
const asked: IntentContext = { exposureId: 'e1', offer: true };

describe('P5.4 voice: what a phrase asks of the session (11 §9)', () => {
  it.each([
    ['Czy mogę dodać wyciskanie hantli zza głowy?', 'wyciskanie hantli zza glowy'],
    ['dorzuć martwy ciąg rumuński', 'martwy ciag rumunski'],
    ['dodaj mi proszę przysiady', 'przysiady'],
    ['czy można dołożyć brzuszki', 'brzuszki'],
  ])('"%s" adds the exercise the words name', (said, query) => {
    expect(matchSessionIntent(said, on)).toEqual({
      kind: 'change',
      change: { kind: 'add_exercise', exercise: { query }, position: 'next' },
    });
    // Adding an exercise needs no exercise to be on.
    expect(matchSessionIntent(said, between)).toMatchObject({ kind: 'change' });
  });

  it.each([
    ['dodaj serię', 1],
    ['jeszcze jedna seria', 1],
    ['dorzuć jedną serię', 1],
    ['czy mogę dodać dwie serie', 2],
    ['dodaj 3 serie', 3],
  ])('"%s" adds %d set(s) to the exercise in progress', (said, sets) => {
    expect(matchSessionIntent(said, on)).toEqual({
      kind: 'change',
      change: { kind: 'add_sets', exposureId: 'e1', sets },
    });
    expect(matchSessionIntent(said, between)).toBeNull();
  });

  it('does not take a count that is not a count of sets', () => {
    expect(matchSessionIntent('dodaj serię trzy dwa', on)).toBeNull();
    expect(matchSessionIntent('dodaj 7 serii', on)).toBeNull();
    expect(matchSessionIntent('dodaj', on)).toBeNull();
    expect(matchSessionIntent('', on)).toBeNull();
    expect(matchSessionIntent('dodaj ' + 'słowo '.repeat(9), on)).toBeNull();
  });

  it('swaps the rest of the exercise for the one named', () => {
    expect(matchSessionIntent('zamień na wyciskanie siedząc', on)).toEqual({
      kind: 'change',
      change: {
        kind: 'swap_remaining',
        exposureId: 'e1',
        exercise: { query: 'wyciskanie siedzac' },
      },
    });
    expect(matchSessionIntent('zamień to na wyciskanie siedząc', between)).toBeNull();
    expect(matchSessionIntent('zamień na', on)).toBeNull();
    expect(matchSessionIntent('zamień na ' + 'a '.repeat(9), on)).toBeNull();
  });

  it.each([
    ['zamień na coś z gumą', 'band'],
    ['zamień na coś z hantlami', 'dumbbell'],
    ['zamień na coś z minigumą', 'mini-band'],
    ['zamień na coś na rowerze', 'bike'],
    ['zamień na coś bez sprzętu', 'bodyweight'],
  ])('"%s" asks for the alternatives of that kind of equipment', (said, family) => {
    expect(matchSessionIntent(said, on)).toEqual({
      kind: 'alternatives',
      exposureId: 'e1',
      family,
    });
    expect(matchSessionIntent(said, between)).toBeNull();
  });

  it('an unknown kind of something is not guessed', () => {
    expect(matchSessionIntent('zamień na coś lekkiego', on)).toBeNull();
  });

  it.each([
    ['za ciężko', 'too_hard'],
    ['to jest za ciężko', 'too_hard'],
    ['zbyt ciężko', 'too_hard'],
    ['za lekko', 'too_easy'],
    ['za łatwo', 'too_easy'],
  ])('"%s" is the feel %s', (said, feel) => {
    expect(matchSessionIntent(said, on)).toEqual({ kind: 'feel', feel });
    expect(matchSessionIntent(said, between)).toEqual({ kind: 'feel', feel });
  });

  it('a feel spoken inside a longer sentence, or the effort of a set, is left alone', () => {
    expect(matchSessionIntent('wczoraj było za ciężko ale dziś dobrze', on)).toBeNull();
    expect(matchSessionIntent('jak było lekko', on)).toBeNull();
    expect(matchSessionIntent('nie za ciężko', on)).toBeNull();
  });

  it('skips the rest of the exercise, and not the exercise', () => {
    expect(matchSessionIntent('pomiń resztę', on)).toEqual({
      kind: 'change',
      change: { kind: 'skip_remaining', exposureId: 'e1' },
    });
    expect(matchSessionIntent('pomiń pozostałe serie', on)).toMatchObject({ kind: 'change' });
    expect(matchSessionIntent('pomiń resztę', between)).toBeNull();
    expect(matchSessionIntent('pomiń ćwiczenie', on)).toBeNull();
  });

  it('a negation is never an order', () => {
    expect(matchSessionIntent('nie dodawaj serii', on)).toBeNull();
    expect(matchSessionIntent('nie zamieniaj na przysiady', on)).toBeNull();
  });

  describe('the answer to a card that was just read out', () => {
    it.each([
      ['tak', 'yes'],
      ['Tak, dodaj', 'yes'],
      ['dodaj', 'yes'],
      ['dobrze', 'yes'],
      ['ok', 'yes'],
      ['tak proszę', 'yes'],
      ['nie', 'no'],
      ['jeszcze nie', 'no'],
      ['nie teraz', 'no'],
      ['anuluj', 'no'],
      ['jednak moje', 'mine'],
      ['moje', 'mine'],
      ['zostaw moje ćwiczenie', 'mine'],
      ['wolę swoje', 'mine'],
    ])('"%s" is %s', (said, answer) => {
      expect(matchSessionIntent(said, asked)).toEqual({ kind: 'answer', answer });
    });

    it('is only an answer while a card waits', () => {
      expect(matchSessionIntent('tak', on)).toBeNull();
      expect(matchSessionIntent('nie', on)).toBeNull();
      expect(matchSessionIntent('jednak moje', on)).toBeNull();
    });

    it('does not take a long or a mixed phrase for an answer', () => {
      expect(matchSessionIntent('tak ale nie teraz', asked)).toBeNull();
      expect(matchSessionIntent('tak dodaj mi jeszcze coś innego', asked)).toBeNull();
      expect(matchSessionIntent('tak nie', asked)).toBeNull();
    });

    it('a new request while a card waits is still a request', () => {
      expect(matchSessionIntent('za ciężko', asked)).toEqual({ kind: 'feel', feel: 'too_hard' });
      expect(matchSessionIntent('dodaj serię', asked)).toMatchObject({ kind: 'change' });
    });
  });
});
