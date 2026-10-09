import { matchCommand, VOICE_ACTIONS, words } from '../voice/commands';
import { matchParameter, type ParameterCommand } from '../voice/parameters';

describe('spoken set parameters', () => {
  it.each<[string, ParameterCommand]>([
    ['ustaw powtórzenia na dwanaście', { action: 'set_reps', reps: 12 }],
    ['ustaw 21 powtórzeń', { action: 'set_reps', reps: 21 }],
    ['zmień liczbę powtórzeń na trzydzieści cztery', { action: 'set_reps', reps: 34 }],
    ['powtórzenia 1', { action: 'set_reps', reps: 1 }],
    ['999 powtórzeń', { action: 'set_reps', reps: 999 }],
    ['ustaw czas na czterdzieści pięć sekund', { action: 'set_time', seconds: 45 }],
    ['czas 3600', { action: 'set_time', seconds: 3600 }],
    ['1 sekunda', { action: 'set_time', seconds: 1 }],
    ['ustaw ciężar na osiem kilogramów', { action: 'set_weight', kg: 8 }],
    ['waga 8,5 kg', { action: 'set_weight', kg: 8.5 }],
    ['8.5kg', { action: 'set_weight', kg: 8.5 }],
    ['1000 kg', { action: 'set_weight', kg: 1000 }],
    ['ustaw gumę na czerwoną', { action: 'set_band', bandId: 'red' }],
    ['zmień gumę na czarną', { action: 'set_band', bandId: 'black' }],
    ['żółta guma', { action: 'set_band', bandId: 'yellow' }],
    ['fioletową gumę', { action: 'set_band', bandId: 'purple' }],
    ['guma zielona', { action: 'set_band', bandId: 'green' }],
    ['ustaw pozycję na P2', { action: 'set_position', position: 2 }],
    ['pozycja p 0', { action: 'set_position', position: 0 }],
    ['ustaw zaczep na trzy', { action: 'set_position', position: 3 }],
    ['ustaw jak było na spokojnie', { action: 'set_effort', rir: 3 }],
    ['ustaw odczucie na ciężko', { action: 'set_effort', rir: 2 }],
    ['jak było bardzo ciężko', { action: 'set_effort', rir: 1 }],
    ['jak było na maksa', { action: 'set_effort', rir: 0 }],
    ['odczucie lekko', { action: 'set_effort', rir: 4 }],
    ['rir zero', { action: 'set_effort', rir: 0 }],
    ['ustaw RIR na cztery', { action: 'set_effort', rir: 4 }],
  ])('%s edits one field', (phrase, command) => {
    expect(matchCommand(phrase, VOICE_ACTIONS)).toEqual({ kind: 'command', command });
  });

  it.each([
    'ustaw 0 powtórzeń',
    'ustaw 1000 powtórzeń',
    'ustaw 2,5 powtórzeń',
    'ustaw czas na 0 sekund',
    'ustaw czas na 3601 sekund',
    'ustaw czas na 1.5 sekund',
    'ustaw wagę na 0 kg',
    'ustaw wagę na 1001 kg',
    'ustaw wagę na -8 kg',
    'ustaw gumę na niebieską',
    'ustaw pozycję na P4',
    'ustaw rir na 5',
    'ustaw odczucie na średnio',
    'nie ustaw 12 powtórzeń',
    'ustaw 12 powtórzeń i zapisz serię',
    'ustaw gumę i pomiń ćwiczenie',
    'czy ustawić ciężar na 8 kg',
    'wczoraj było ciężko',
    'ciężko',
  ])('leaves invalid or conversational text alone: %s', (phrase) => {
    expect(matchCommand(phrase, VOICE_ACTIONS)).toEqual({ kind: 'unknown' });
  });

  it('cannot edit during rest or use an unavailable field', () => {
    expect(matchCommand('ustaw jak było na spokojnie', ['rest_end', 'rest_extend'])).toEqual({
      kind: 'unknown',
    });
    expect(matchCommand('ustaw 12 powtórzeń', ['set_time', 'set_effort'])).toEqual({
      kind: 'unknown',
    });
    expect(matchCommand('seria zrobiona', ['set_reps', 'set_effort'])).toEqual({ kind: 'unknown' });
  });

  it('preserves decimals, compound numbers and new Polish number words', () => {
    expect(
      words(
        'cztery sześć siedem osiem dziewięć jedenaście dwanaście trzynaście czternaście szesnaście siedemnaście osiemnaście dziewiętnaście',
      ),
    ).toEqual(['4', '6', '7', '8', '9', '11', '12', '13', '14', '16', '17', '18', '19']);
    expect(words('siedemdziesiąt dwa osiemdziesiąt pięć')).toEqual(['72', '85']);
    expect(words('…')).toEqual([]);
    expect(matchParameter([])).toBeNull();
  });
});
