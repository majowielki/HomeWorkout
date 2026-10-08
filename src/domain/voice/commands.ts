import { fold } from '../coach/text';

/**
 * Voice commands during a session: what a spoken phrase asks for, decided on
 * the phone from a fixed vocabulary. Only the actions the current screen
 * offers are considered, so "koniec" stops the stopwatch while a set runs
 * and ends the rest during a rest. A phrase the vocabulary does not cover is
 * `unknown`, never a guess; what to do with it is the caller's choice.
 */

export const VOICE_ACTIONS = [
  'stopwatch_start',
  'stopwatch_stop',
  'set_done',
  'rest_end',
  'rest_extend',
  'skip_exercise',
] as const;

export type VoiceActionId = (typeof VOICE_ACTIONS)[number];

export type VoiceCommand =
  { action: 'rest_extend'; seconds: number } | { action: Exclude<VoiceActionId, 'rest_extend'> };

export type VoiceMatch =
  | { kind: 'command'; command: VoiceCommand }
  /** Two available actions fit equally well ("pomiń" during a rest). */
  | { kind: 'ambiguous'; actions: VoiceActionId[] }
  | { kind: 'unknown' };

/** What "+30 s" adds when the phrase names no amount, and the bounds of one that does. */
export const DEFAULT_EXTEND_SEC = 30;
export const MIN_EXTEND_SEC = 5;
export const MAX_EXTEND_SEC = 180;

/**
 * A phrase is a list of words that must appear in this order, other words
 * allowed between them. A word ending in `*` matches by prefix, so one entry
 * covers "zrobiona", "zrobione" and "zrobiony"; any other word must match
 * whole ("stop" is not "stoper").
 */
const PHRASES: Record<VoiceActionId, readonly string[]> = {
  stopwatch_start: [
    'start*',
    'wystartuj',
    'zacznij',
    'zaczynam*',
    'rozpocznij',
    'rozpoczynam*',
    'wlacz stoper',
    'uruchom*',
    'odpal*',
    'mierz*',
    'jedziemy',
    'lecimy',
  ],
  stopwatch_stop: [
    'stop',
    'stopuj',
    'stoj',
    'zatrzymaj*',
    'koniec',
    'wylacz*',
    'dosc',
    'starczy',
    'wystarczy',
  ],
  set_done: [
    'seria zrobion*',
    'seria gotow*',
    'seria skonczon*',
    'koniec serii',
    'zrobion*',
    'zrobil*',
    'gotow*',
    'skonczyl*',
    'zapisz*',
    'zalicz*',
  ],
  rest_end: [
    'koniec przerwy',
    'koniec',
    'pomin przerw*',
    'pomin',
    'przerwa koniec',
    'starczy',
    'wystarczy',
    'dalej',
    'gotow*',
    'jedziemy',
    'lecimy',
    'zaczynam*',
    'start*',
    'nastepna seri*',
  ],
  rest_extend: [
    'plus',
    'dodaj*',
    'przedluz*',
    'dluzsz*',
    'wiecej przerwy',
    'jeszcze chwil*',
    'jeszcze # sekund*',
    'jeszcze # minut*',
    'jeszcze minut*',
  ],
  skip_exercise: ['pomin cwicz*', 'pomin', 'nastepne cwicz*', 'przeskocz*', 'opusc*'],
};

/** "nie kończ przerwy" must not end it. A negated phrase is left to someone who understands it. */
const NEGATIONS = new Set(['nie', 'niech', 'czekaj', 'zaczekaj', 'poczekaj']);

/** A command is a few words; a sentence around one is more than the vocabulary should judge. */
const MAX_EXTRA_WORDS = 3;

const NUMBER_WORDS: Record<string, number> = {
  jedna: 1,
  jedno: 1,
  jeden: 1,
  dwie: 2,
  dwa: 2,
  trzy: 3,
  piec: 5,
  dziesiec: 10,
  pietnascie: 15,
  dwadziescia: 20,
  trzydziesci: 30,
  czterdziesci: 40,
  piecdziesiat: 50,
  szescdziesiat: 60,
  dziewiecdziesiat: 90,
  sto: 100,
};

/** "czterdzieści pięć" is one number. */
const TENS = new Set([20, 30, 40, 50, 60, 90]);

/**
 * Folded words, with numbers as digits: "Plus trzydzieści sekund!" becomes
 * plus / 30 / sekund. Recognisers write "+30 s" as often as they spell it out.
 */
export function words(transcript: string): string[] {
  const raw = fold(transcript)
    .replace(/\+/g, ' plus ')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '');
  const out: string[] = [];
  for (const word of raw) {
    const value = NUMBER_WORDS[word];
    const previous = out.length > 0 ? Number(out[out.length - 1]) : NaN;
    if (value !== undefined && value < 10 && TENS.has(previous)) {
      out[out.length - 1] = String(previous + value);
    } else {
      out.push(value === undefined ? word : String(value));
    }
  }
  return out;
}

const isNumber = (word: string) => /^\d+$/.test(word);

function tokenMatches(pattern: string, word: string): boolean {
  if (pattern === '#') return isNumber(word);
  return pattern.endsWith('*') ? word.startsWith(pattern.slice(0, -1)) : word === pattern;
}

/** Positions of the pattern's words in order, or null when they are not all there. */
function find(pattern: readonly string[], ws: readonly string[]): number[] | null {
  const at: number[] = [];
  let from = 0;
  for (const token of pattern) {
    let i = from;
    while (i < ws.length && !tokenMatches(token, ws[i]!)) i += 1;
    if (i >= ws.length) return null;
    at.push(i);
    from = i + 1;
  }
  return at;
}

/**
 * The amount a "+…" phrase names: "plus 45", "jeszcze minuta", "pół minuty",
 * "dodaj 2 minuty". No amount is the usual 30 s.
 */
export function extendSeconds(ws: readonly string[]): number {
  const minuteAt = ws.findIndex((w) => w.startsWith('minut') || w === 'min');
  const numberAt = ws.findIndex(isNumber);
  let seconds = DEFAULT_EXTEND_SEC;
  if (minuteAt >= 0) {
    const half = minuteAt > 0 && ws[minuteAt - 1] === 'pol';
    const count = numberAt >= 0 && numberAt < minuteAt ? Number(ws[numberAt]) : 1;
    seconds = half ? 30 : count * 60;
  } else if (numberAt >= 0) {
    seconds = Number(ws[numberAt]);
  }
  return Math.min(MAX_EXTEND_SEC, Math.max(MIN_EXTEND_SEC, seconds));
}

/** Words that only carry the amount or the unit, so they do not count as extra. */
const AMOUNT_WORDS = /^(\d+|sekund\w*|s|sek|minut\w*|min|pol|przerw\w*)$/;

/**
 * The best fit of one transcript among the available actions. Each action
 * scores by its longest matching phrase; the highest wins, a tie between two
 * actions is ambiguous.
 */
export function matchCommand(transcript: string, available: readonly VoiceActionId[]): VoiceMatch {
  const ws = words(transcript);
  if (ws.length === 0 || ws.some((w) => NEGATIONS.has(w))) return { kind: 'unknown' };

  const scored: { action: VoiceActionId; score: number; used: Set<number> }[] = [];
  for (const action of available) {
    let best: { score: number; used: Set<number> } | null = null;
    for (const phrase of PHRASES[action]) {
      const at = find(phrase.split(' '), ws);
      if (at && (!best || at.length > best.score)) best = { score: at.length, used: new Set(at) };
    }
    if (best) scored.push({ action, ...best });
  }
  if (scored.length === 0) return { kind: 'unknown' };

  const top = Math.max(...scored.map((s) => s.score));
  const winners = scored.filter((s) => s.score === top);
  if (winners.length > 1) return { kind: 'ambiguous', actions: winners.map((w) => w.action) };

  const winner = winners[0]!;
  const extra = ws.filter(
    (w, i) => !winner.used.has(i) && !(winner.action === 'rest_extend' && AMOUNT_WORDS.test(w)),
  ).length;
  if (extra > MAX_EXTRA_WORDS) return { kind: 'unknown' };

  return {
    kind: 'command',
    command:
      winner.action === 'rest_extend'
        ? { action: 'rest_extend', seconds: extendSeconds(ws) }
        : { action: winner.action },
  };
}

/**
 * Recognisers return a few guesses, best first. The first one the
 * vocabulary is sure of wins; failing that, an ambiguous one is still worth
 * reporting over nothing.
 */
export function matchAlternatives(
  transcripts: readonly string[],
  available: readonly VoiceActionId[],
): VoiceMatch {
  let fallback: VoiceMatch = { kind: 'unknown' };
  for (const transcript of transcripts) {
    const match = matchCommand(transcript, available);
    if (match.kind === 'command') return match;
    if (match.kind === 'ambiguous' && fallback.kind === 'unknown') fallback = match;
  }
  return fallback;
}
