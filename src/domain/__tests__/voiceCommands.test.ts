import { matchAlternatives, matchCommand, type VoiceActionId, words } from '../voice/commands';

/** What each screen of the session offers. */
const SET_TIMED_IDLE: VoiceActionId[] = ['stopwatch_start', 'set_done', 'skip_exercise'];
const SET_TIMED_RUNNING: VoiceActionId[] = ['stopwatch_stop', 'set_done', 'skip_exercise'];
const SET_REPS: VoiceActionId[] = ['set_done', 'skip_exercise'];
const REST: VoiceActionId[] = ['rest_end', 'rest_extend', 'skip_exercise'];

const action = (transcript: string, available: VoiceActionId[]) => {
  const match = matchCommand(transcript, available);
  return match.kind === 'command' ? match.command.action : match.kind;
};

describe('words', () => {
  it('folds, drops punctuation and writes numbers as digits', () => {
    expect(words('Plus trzydzieści sekund!')).toEqual(['plus', '30', 'sekund']);
    expect(words('+30s przerwy')).toEqual(['plus', '30', 's', 'przerwy']);
    expect(words('czterdzieści pięć sekund')).toEqual(['45', 'sekund']);
  });
});

describe('the first commands', () => {
  it.each([
    ['start', 'stopwatch_start'],
    ['Startuj', 'stopwatch_start'],
    ['zaczynam', 'stopwatch_start'],
    ['włącz stoper', 'stopwatch_start'],
    ['uruchom stoper', 'stopwatch_start'],
  ])('starts the stopwatch: %s', (phrase, expected) => {
    expect(action(phrase, SET_TIMED_IDLE)).toBe(expected);
  });

  it.each(['stop', 'Stój', 'zatrzymaj', 'koniec', 'wyłącz stoper', 'wystarczy'])(
    'stops the stopwatch: %s',
    (phrase) => {
      expect(action(phrase, SET_TIMED_RUNNING)).toBe('stopwatch_stop');
    },
  );

  it.each(['koniec przerwy', 'Koniec przerwy.', 'pomiń przerwę', 'dalej', 'gotowe', 'koniec'])(
    'ends the rest: %s',
    (phrase) => {
      expect(action(phrase, REST)).toBe('rest_end');
    },
  );

  it.each([
    'seria zrobiona',
    'Seria zrobiona!',
    'zrobione',
    'zrobiłem',
    'skończyłam',
    'gotowe',
    'zapisz serię',
    'koniec serii',
    'dobra, seria zrobiona',
  ])('logs the set: %s', (phrase) => {
    expect(action(phrase, SET_REPS)).toBe('set_done');
  });

  it.each(['pomiń ćwiczenie', 'Pomiń to ćwiczenie', 'następne ćwiczenie', 'przeskocz'])(
    'skips the exercise: %s',
    (phrase) => {
      expect(action(phrase, SET_REPS)).toBe('skip_exercise');
      expect(action(phrase, REST)).toBe('skip_exercise');
    },
  );

  it.each([
    ['+30 sekund', 30],
    ['plus 30 sekund przerwy', 30],
    ['plus trzydzieści', 30],
    ['dodaj trzydzieści sekund', 30],
    ['przedłuż przerwę', 30],
    ['jeszcze chwila', 30],
    ['jeszcze 45 sekund', 45],
    ['plus minuta', 60],
    ['dodaj pół minuty', 30],
    ['plus dwie minuty', 120],
    ['plus 15', 15],
  ])('extends the rest: %s -> %d s', (phrase, seconds) => {
    expect(matchCommand(phrase, REST)).toEqual({
      kind: 'command',
      command: { action: 'rest_extend', seconds },
    });
  });

  it('keeps an extension within bounds', () => {
    expect(matchCommand('plus 10 minut', REST)).toEqual({
      kind: 'command',
      command: { action: 'rest_extend', seconds: 180 },
    });
  });
});

describe('the screen decides', () => {
  it('"koniec" stops the stopwatch during a set and ends a rest during a rest', () => {
    expect(action('koniec', SET_TIMED_RUNNING)).toBe('stopwatch_stop');
    expect(action('koniec', REST)).toBe('rest_end');
  });

  it('"koniec serii" logs the set even while the stopwatch runs', () => {
    expect(action('koniec serii', SET_TIMED_RUNNING)).toBe('set_done');
  });

  it('an action the screen does not offer is not chosen', () => {
    expect(action('start', SET_REPS)).toBe('unknown');
    expect(action('koniec przerwy', SET_REPS)).toBe('unknown');
    expect(action('plus 30 sekund', SET_REPS)).toBe('unknown');
  });

  it('a bare "pomiń" during a rest is ambiguous, and an exercise skip during a set', () => {
    expect(matchCommand('pomiń', REST)).toEqual({
      kind: 'ambiguous',
      actions: ['rest_end', 'skip_exercise'],
    });
    expect(action('pomiń', SET_REPS)).toBe('skip_exercise');
  });

  it('"stoper" is not "stop"', () => {
    expect(action('stoper', SET_TIMED_RUNNING)).toBe('unknown');
  });
});

describe('what the vocabulary leaves alone', () => {
  it.each(['nie kończ przerwy', 'nie pomijaj', 'czekaj', 'niech leci', ''])(
    'a negation or nothing: "%s"',
    (phrase) => {
      expect(action(phrase, REST)).toBe('unknown');
    },
  );

  it('a sentence around a command word', () => {
    expect(action('wiesz co chyba już mam dość tego ćwiczenia na dziś', REST)).toBe('unknown');
    expect(action('dobra to była naprawdę bardzo ciężka seria zrobiona', SET_REPS)).toBe('unknown');
  });

  it('words it does not know', () => {
    expect(action('zmień obciążenie', SET_REPS)).toBe('unknown');
    expect(action('ile jeszcze serii', REST)).toBe('unknown');
  });
});

describe('matchAlternatives', () => {
  it('takes the first guess the vocabulary is sure of', () => {
    expect(matchAlternatives(['kończ przerwy', 'koniec przerwy'], REST)).toEqual({
      kind: 'command',
      command: { action: 'rest_end' },
    });
  });

  it('an ambiguous guess beats none', () => {
    expect(matchAlternatives(['pomiń', 'bla bla'], REST).kind).toBe('ambiguous');
    expect(matchAlternatives(['bla bla'], REST).kind).toBe('unknown');
  });
});
