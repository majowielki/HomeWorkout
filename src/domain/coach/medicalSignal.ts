import { clauses, hasStem } from './text';

/**
 * What a piece of free text says about the body.
 *
 *  - `medical`  — injury, joint / tendon / spine pain, numbness, swelling, a
 *    doctor or physio, a red-flag symptom, pain nobody located, or a joint
 *    mentioned with no sign that all is well. The app answers with a fixed
 *    formula and never sends the text to a model.
 *  - `soreness` — muscle soreness after training (DOMS). A normal training
 *    fact that the rules engine wants to know about.
 *  - `none`     — neither.
 *
 * The bias is deliberate: a false `medical` costs the user a fixed sentence
 * and a manual form; a false `none` hands an injury note to a language
 * model. Where the two readings are close, `medical` wins.
 *
 * This is a lexicon, not understanding. It is precise on direct language
 * ("boli kolano") and leaky on indirect language, so it is the first of two
 * layers: the prompt guardrail and the output guard are the second
 * (docs/adr/0003). Recall numbers: Documents/AI-INTEGRACJA.md §10.0.
 */
export type TextSignal = 'medical' | 'soreness' | 'none';

/*
 * Word lists are stems of folded text (lowercase, no diacritics — see
 * text.ts). A token matches when it starts with a stem, except where a list
 * says "exact". Corpora: evals/cases/medical-signal.
 */

/** Injury vocabulary: medical wherever it appears, unless negated. */
const STRONG = [
  'strzyk', // strzyka, strzyknęło
  'strzel', // "strzeliło mi w barku"
  'uraz',
  'kontuz',
  'naciag',
  'naderw',
  'zerwa',
  'skreci', // skręcił(em) — not "skręty tułowia"
  'skrecen',
  'zwichn',
  'stlucz',
  'zapalen', // zapalenie ścięgna
  'lekarz',
  'ortoped',
  'fizjoter',
  'rehabilit',
  'kluj', // kłuje
  'klucie',
  'klul',
  'promieni',
  'pekl', // "pękło mi w łydce"
  'zablok',
  'wykrec',
  'ucisk', // chest pressure is a red flag
  'dusznos',
  'zawrot',
  'zakrecil', // "zakręciło mi się w głowie"
  'omdl',
  'zemdl',
  'zaslab',
  'kolatani',
  'przeciazon', // "przeciążony nadgarstek" — not "przeciążenie progresywne"
  'uszkodz',
  'zlam',
  'operac',
  'rezonans',
  'rwani', // "rwanie w udzie"
  'dyskomfort',
];

/** Short words that must match whole: "rwa" must not match "rwanie"'s relatives. */
const STRONG_EXACT = new Set(['rwa', 'rwe', 'rwy', 'rwie', 'piecze']);

/** Idioms no single word gives away. Matched against a folded clause. */
const STRONG_PHRASES = [
  /ciemno przed oczami/,
  /kreci mi sie w glowie/,
  /robi mi sie slabo/,
  /o sobie znac/, // "kolano daje o sobie znać"
  /we znaki/, // "stawy dają mi się we znaki"
];

/** Symptoms that only mean something next to a body part. */
const SYMPTOM = [
  'spuch',
  'opuch',
  'puchn',
  'obrzek',
  'dretw',
  'cierp', // cierpnie ręka
  'mrowi',
  'przeskak',
  'uciek', // "kolano mi uciekło" — but "ucieka mi czas"
  'trzeszcz',
  'blokuj',
  'ciagn',
];

const PAIN = ['bol', 'pobol', 'obolal', 'dokucz', 'dolegliw'];

/** Muscle soreness vocabulary (DOMS) and its typos. */
const SORE = ['zakwas', 'zakws', 'doms'];

/** Joints, tendons, spine. Adjectives ("barkowe", "biodrowy") are filtered out. */
const JOINT = [
  'kolan',
  'kostk',
  'kostc',
  'nadgarst',
  'lokc',
  'lokie',
  'bark',
  'kregoslup',
  'sciegn',
  'achill',
  'biodr',
  'bioder',
  'pachw',
  'rzepk',
  'kark',
  'szyj',
  'krzyz',
  'ledzw',
  'lopatk',
];

/** "staw" as a stem would also catch "stawiam" and "stawka". */
const JOINT_EXACT = new Set([
  'staw',
  'stawy',
  'stawu',
  'stawow',
  'stawie',
  'stawem',
  'stawach',
  'stawami',
]);

/** Body parts that count for pain and symptoms, but are not worth a verdict on their own. */
const EXTREMITY = ['palc', 'dlon', 'reka', 'rece', 'reki', 'glow'];
const EXTREMITY_EXACT = new Set(['stopa', 'stopy', 'stope', 'stopie', 'noga']);

/** Muscle groups: pain next to one of these is soreness. */
const MUSCLE = [
  'nog', // noga, nogi, nogach
  'lydk',
  'posladk',
  'ramie',
  'ramion',
  'klatk',
  'biceps',
  'triceps',
  'czworogl',
  'dwugl',
  'miesn',
];
const MUSCLE_EXACT = new Set(['uda', 'udach', 'udami', 'udo', 'udzie', 'udzi']);

/** The back is a muscle after rowing and a spine otherwise; context decides. */
const BACK_EXACT = new Set(['plecy', 'plecach', 'plecow', 'plecami', 'grzbiet', 'grzbiecie']);

/** Words that tie a complaint to a recent workout: "po wczorajszym", "po wiosłowaniu". */
const WORKOUT_CONTEXT = [
  'wczoraj',
  'trening',
  'sesj',
  'przysiad',
  'wioslow',
  'martw',
  'cwiczen',
  'pompk',
  'wyciskan',
  'seri',
  'rdz',
  'rower',
  'mostk',
];

const NEGATORS = new Set(['bez', 'nie', 'brak', 'braku', 'zadnego', 'zadnej', 'zadnych', 'nic']);

/**
 * A joint named with one of these is not a complaint: "kolano ok", "kolano
 * pilnowałem", "uginanie kolan pominę". Anything else mentioning a joint is
 * read as possibly one.
 */
const ALL_CLEAR = [
  'ok',
  'porzadk',
  'stabil',
  'dobr',
  'swietn',
  'super',
  'normaln',
  'lekko',
  'gladk',
  'poszl',
  'pilnow',
  'kontrol',
  'uwaz',
  'pomin',
  'silniejsz',
  'mocn',
  'wzmacn',
];
const ALL_CLEAR_EXACT = new Set([...NEGATORS, 'okej']);

const ADJECTIVAL = /(owy|owa|owe|owym|owej|owych|owego|owemu|owi)$/;

function isJointToken(token: string): boolean {
  if (JOINT_EXACT.has(token)) return true;
  return JOINT.some((stem) => token.startsWith(stem)) && !ADJECTIVAL.test(token);
}

/** "nie boli", "bez bólu", "nic nie strzyka": a negator within the two tokens before. */
function isNegated(tokens: readonly string[], index: number): boolean {
  return tokens.slice(Math.max(0, index - 2), index).some((token) => NEGATORS.has(token));
}

/** Tokens matching `test` that no negator in front of them cancels. */
function liveHits(tokens: readonly string[], test: (token: string) => boolean): number {
  return tokens.filter((token, index) => test(token) && !isNegated(tokens, index)).length;
}

const startsWithAny = (stems: readonly string[]) => (token: string) =>
  stems.some((stem) => token.startsWith(stem));

const isStrong = (token: string) => startsWithAny(STRONG)(token) || STRONG_EXACT.has(token);

function classifyClause(tokens: readonly string[]): TextSignal {
  if (liveHits(tokens, isStrong) > 0) return 'medical';
  const sentence = tokens.join(' ');
  if (STRONG_PHRASES.some((phrase) => phrase.test(sentence))) return 'medical';

  const hasJoint = tokens.some(isJointToken);
  const hasMuscle = hasStem(tokens, MUSCLE) || tokens.some((t) => MUSCLE_EXACT.has(t));
  const hasBack = tokens.some((t) => BACK_EXACT.has(t));
  const hasExtremity = hasStem(tokens, EXTREMITY) || tokens.some((t) => EXTREMITY_EXACT.has(t));
  const afterWorkout = tokens.includes('po') && hasStem(tokens, WORKOUT_CONTEXT);

  if (liveHits(tokens, startsWithAny(SYMPTOM)) > 0) {
    if (hasJoint || hasMuscle || hasBack || hasExtremity) return 'medical';
  }

  if (liveHits(tokens, startsWithAny(PAIN)) > 0) {
    if (hasJoint) return 'medical';
    if (hasMuscle) return 'soreness';
    if (hasBack && afterWorkout) return 'soreness';
    // Pain nobody located: the safe side.
    return 'medical';
  }

  if (liveHits(tokens, startsWithAny(SORE)) > 0) return hasJoint ? 'medical' : 'soreness';

  const allClear = hasStem(tokens, ALL_CLEAR) || tokens.some((t) => ALL_CLEAR_EXACT.has(t));
  if (hasJoint && !allClear) return 'medical';
  return 'none';
}

const RANK: Record<TextSignal, number> = { none: 0, soreness: 1, medical: 2 };

/**
 * Classify free text, clause by clause, and return the strongest reading.
 * Pure and offline: this is the gate that runs *before* any network call
 * (AI-INTEGRACJA I3).
 */
export function detectTextSignal(text: string): TextSignal {
  let result: TextSignal = 'none';
  for (const clause of clauses(text)) {
    const signal = classifyClause(clause);
    if (RANK[signal] > RANK[result]) result = signal;
    if (result === 'medical') break;
  }
  return result;
}
