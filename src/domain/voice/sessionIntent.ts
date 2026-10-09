import type { EquipmentFamily } from '../catalog/attributes';
import type { FeelChange, SessionPlanChange } from '../session/types';
import { words } from './commands';

/**
 * What a spoken phrase asks of the session while it is running (engine v2,
 * 11 §9): to add or swap an exercise, to add a set, to say it was too hard or
 * too easy, to skip the rest of an exercise, or to answer a card that was just
 * read out. Decided on the phone from a fixed vocabulary, like the commands of
 * the stopwatch; the result is a `SessionChange` with the *words* of the
 * exercise, which the catalogue resolver (not this file) turns into an
 * exercise, so a name the catalogue does not know is answered by the engine and
 * never guessed here. A phrase the vocabulary does not cover is `null`.
 */

export type VoiceChange = Extract<
  SessionPlanChange,
  { kind: 'add_exercise' | 'swap_remaining' | 'add_sets' | 'skip_remaining' }
>;

export type VoiceSessionIntent =
  | { kind: 'change'; change: VoiceChange }
  | { kind: 'feel'; feel: FeelChange['feel'] }
  /** "Zamień na coś z gumą": the alternatives of the current exercise, of that kind of equipment. */
  | { kind: 'alternatives'; exposureId: string; family: EquipmentFamily }
  /** The answer to a card that was just offered. */
  | { kind: 'answer'; answer: 'yes' | 'no' | 'mine' };

export interface IntentContext {
  /** The exercise the person is on; null between exercises. */
  exposureId: string | null;
  /** A card (an assessment, a question about a step up) was read out and waits for an answer. */
  offer: boolean;
}

const MAX_QUERY_WORDS = 8;

const ADD_VERB = '(?:dodac|dodaj|dorzucic|dorzuc|dolozyc|doloz|wrzucic|wrzuc)';
/** Words that only soften the request and are not part of an exercise's name. */
const FILLER = new Set([
  'mi',
  'prosze',
  'jakies',
  'jakis',
  'jakas',
  'jeszcze',
  'tez',
  'moze',
  'to',
]);

const FAMILIES: [RegExp, EquipmentFamily][] = [
  [/\b(?:mini ?gum\w*|mini ?band\w*)\b/, 'mini-band'],
  [/\bgum\w*\b/, 'band'],
  [/\bhantl\w*\b|\bhantel\w*\b/, 'dumbbell'],
  [/\brower\w*\b/, 'bike'],
  [/\b(?:bez sprzetu|masa ciala|masy ciala|ciezarem ciala|wlasn\w+ cial\w*)\b/, 'bodyweight'],
];

const SET_COUNTS: Record<string, number> = { '1': 1, '2': 2, '3': 3 };

/** "Serię" in any form, optionally with a count: "dwie serie", "jedną serię", "2 serie". */
function setsAsked(rest: readonly string[]): number | null {
  const noun = rest.findIndex((w) => /^seri\w*$/.test(w));
  if (noun < 0) return null;
  const others = rest.filter(
    (w, i) => i !== noun && !FILLER.has(w) && !/^(?:jedn\w+|jeden)$/.test(w),
  );
  const counts = others.filter((w) => SET_COUNTS[w] !== undefined);
  if (others.length !== counts.length || counts.length > 1) return null;
  return counts.length === 1 ? SET_COUNTS[counts[0]!]! : 1;
}

const YES = new Set([
  'tak',
  'dobra',
  'dobrze',
  'ok',
  'okej',
  'zgoda',
  'potwierdzam',
  'dodaj',
  'dodajemy',
]);
const NO = new Set(['nie', 'anuluj', 'odpusc', 'rezygnuje', 'zostaw']);

function answerOf(ws: readonly string[]): 'yes' | 'no' | 'mine' | null {
  if (ws.length === 0 || ws.length > 4) return null;
  const text = ws.join(' ');
  if (/^(?:jednak |zostaw |chce |wole )?(?:moje|swoje|wlasne|moj|swoj)(?: cwiczenie)?$/.test(text))
    return 'mine';
  if (/^jeszcze nie$|^nie teraz$|^nie dodawaj$|^nie rob$/.test(text)) return 'no';
  if (ws.length === 1 && NO.has(ws[0]!)) return 'no';
  if (ws.some((w) => w === 'nie')) return null;
  if (ws.every((w) => YES.has(w) || w === 'to' || w === 'prosze')) return 'yes';
  return null;
}

/**
 * The intent of a transcript, or null. The words of an exercise are cut out of
 * the phrase as they were said (folded), for the catalogue to resolve.
 */
export function matchSessionIntent(
  transcript: string,
  ctx: IntentContext,
): VoiceSessionIntent | null {
  const ws = words(transcript);
  if (ws.length === 0) return null;

  if (ctx.offer) {
    const answer = answerOf(ws);
    if (answer !== null) return { kind: 'answer', answer };
  }
  if (ws.includes('nie')) return null;
  const text = ws.join(' ');

  // "za ciężko", "za lekko"
  const feel = /\b(?:za|zbyt) (ciezko|lekko|latwo)\b/.exec(text);
  if (feel && ws.length <= 4)
    return { kind: 'feel', feel: feel[1] === 'ciezko' ? 'too_hard' : 'too_easy' };

  const exposureId = ctx.exposureId;
  if (/^pomin (?:reszte|pozostale)(?: seri\w*| cwicz\w*)?$/.test(text)) {
    return exposureId === null
      ? null
      : { kind: 'change', change: { kind: 'skip_remaining', exposureId } };
  }

  // "zamień na ..." — the exercise named, or a kind of equipment
  const swap =
    /^(?:czy )?(?:moge |mozna )?(?:zamien|zamienic|podmien|podmienic) (?:to )?na (.+)$/.exec(text);
  if (swap) {
    if (exposureId === null) return null;
    const rest = swap[1]!.split(' ').filter((w) => !FILLER.has(w));
    const something = /^(?:cos|coz|cokolwiek|jakies?)\b/.test(rest.join(' '));
    if (something) {
      const family = FAMILIES.find(([re]) => re.test(rest.join(' ')))?.[1];
      return family === undefined ? null : { kind: 'alternatives', exposureId, family };
    }
    return rest.length === 0 || rest.length > MAX_QUERY_WORDS
      ? null
      : {
          kind: 'change',
          change: { kind: 'swap_remaining', exposureId, exercise: { query: rest.join(' ') } },
        };
  }

  // "dodaj ...", "czy mogę dorzucić ..."
  const add = new RegExp(`^(?:czy )?(?:moge |mozna |moglbym )?${ADD_VERB} (.+)$`).exec(text);
  if (add) {
    const rest = add[1]!.split(' ');
    const count = setsAsked(rest);
    // A phrase about sets with a count that is none is not the name of an exercise.
    if (count === null && rest.some((w) => /^seri\w*$/.test(w))) return null;
    if (count !== null) {
      return exposureId === null
        ? null
        : { kind: 'change', change: { kind: 'add_sets', exposureId, sets: count } };
    }
    const query = rest.filter((w) => !FILLER.has(w));
    return query.length === 0 || query.length > MAX_QUERY_WORDS
      ? null
      : {
          kind: 'change',
          change: { kind: 'add_exercise', exercise: { query: query.join(' ') }, position: 'next' },
        };
  }
  // "jeszcze jedna seria"
  const another = /^jeszcze (?:1|jedn\w+) seri\w*$/.test(text);
  if (another) {
    return exposureId === null
      ? null
      : { kind: 'change', change: { kind: 'add_sets', exposureId, sets: 1 } };
  }
  return null;
}
