import { fold } from '../coach/text';
import { BANDS } from '../inventory';
import type { AnchorPosition } from '../types';

export type ParameterCommand =
  | { action: 'set_reps'; reps: number }
  | { action: 'set_time'; seconds: number }
  | { action: 'set_weight'; kg: number }
  | { action: 'set_band'; bandId: string }
  | { action: 'set_position'; position: AnchorPosition }
  | { action: 'set_effort'; rir: number };

/** Keep edits out of the legacy action matcher and its action-only AI fallback. */
export function isParameterUtterance(transcript: string): boolean {
  return /\b(ustaw\w*|zmien\w*|powtorzen\w*|czas|waga|wage|kg|kilogram\w*|ciezar\w*|obciazen\w*|hantel\w*|hantl\w*|gum\w*|pozycj\w*|zaczep\w*|odczuci\w*|rir|jak bylo)\b/.test(
    fold(transcript),
  );
}

/** Full phrases only: no partial changes from questions, negations or multiple commands. */
export function matchParameter(words: readonly string[]): ParameterCommand | null {
  const text = words.join(' ').replace(/^(?:ustaw|zmien) /, '');
  const numeric = (field: string, unit: string) => {
    const match =
      new RegExp(`^(?:${field})(?: na)? (\\d+(?:\\.\\d+)?)(?: (?:${unit}))?$`).exec(text) ??
      new RegExp(`^(\\d+(?:\\.\\d+)?) (?:${unit})$`).exec(text);
    return match ? Number(match[1]) : null;
  };
  const reps = numeric(
    'powtorzenia|powtorzen|liczbe powtorzen',
    'powtorzenia|powtorzen|powtorzenie',
  );
  if (reps !== null) {
    return Number.isInteger(reps) && reps >= 1 && reps <= 999 ? { action: 'set_reps', reps } : null;
  }
  const seconds = numeric('czas', 's|sek|sekund|sekundy|sekunda');
  if (seconds !== null) {
    return Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600
      ? { action: 'set_time', seconds }
      : null;
  }
  const kg = numeric(
    'wage|waga|ciezar|obciazenie|hantel|hantle',
    'kg|kilogram|kilogramy|kilogramow',
  );
  if (kg !== null) return kg > 0 && kg <= 1000 ? { action: 'set_weight', kg } : null;

  const band = /^(?:guma|gume)(?: na)? (\w+)$/.exec(text) ?? /^(\w+) (?:guma|gume)$/.exec(text);
  if (band) {
    // Polish accusative and nominative endings both fold to -a.
    const colour = band[1]!.replace(/e$/, 'a');
    const found = BANDS.find((b) => fold(b.label) === colour);
    return found ? { action: 'set_band', bandId: found.id } : null;
  }

  const position = /^(?:pozycja|pozycje|zaczep)(?: na)? (?:p ?)?([0-3])$/.exec(text);
  if (position) return { action: 'set_position', position: Number(position[1]) as AnchorPosition };

  const effort = /^(?:jak bylo|odczucie|rir)(?: na)? (.+)$/.exec(text);
  if (effort) {
    const levels: Record<string, number> = {
      'na maksa': 0,
      maksa: 0,
      'bardzo ciezko': 1,
      ciezko: 2,
      spokojnie: 3,
      lekko: 4,
      '0': 0,
      '1': 1,
      '2': 2,
      '3': 3,
      '4': 4,
    };
    const rir = levels[effort[1]!];
    if (rir !== undefined) return { action: 'set_effort', rir };
  }
  return null;
}
