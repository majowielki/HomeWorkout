/**
 * Polish sentences for a session-change assessment (engine, 11 §8, P4b.6).
 *
 * The same card of facts is shown with or without the network: the AI tells
 * it in its own words, this file tells it from the codes and the numbers, and
 * nothing here is read from anywhere but the assessment. A sentence names no
 * number that the assessment did not carry, and a missing number makes the
 * sentence plainer rather than wrong. The voice reads the first two sentences,
 * so the order is fixed: the verdict, then the findings that matter most,
 * then what the engine recommends, then what else could be done.
 */
import type { ExerciseMatch } from '../catalog/resolve';
import type { SetsReason } from '../plan/sets';
import {
  sortChecks,
  type AssessmentCheck,
  type RuleCode,
  type Verdict,
} from '../policy/hardAdvice';
import type { MuscleGroup } from '../types';
import type { ChangeAssessment, FeelOption, PrescriptionSummary, RankedAlternative } from './types';

export interface AssessmentTextOptions {
  /** Name of a catalogue exercise to show; the id is used when none is given. */
  exerciseName?: (exerciseId: string) => string | undefined;
  /** Most alternatives to mention. */
  maxAlternatives?: number;
}

const MUSCLE: Record<MuscleGroup, string> = {
  quads: 'czworogłowe',
  hamstrings: 'dwugłowe uda',
  glutes: 'pośladki',
  calves: 'łydki',
  chest: 'klatka',
  back: 'plecy',
  lats: 'najszersze',
  shoulders: 'barki',
  biceps: 'biceps',
  triceps: 'triceps',
  core: 'core',
  forearms: 'przedramiona',
};

const VERDICT: Record<Verdict, string> = {
  ok: 'Można.',
  ok_with_changes: 'Można, z poprawkami.',
  not_recommended: 'Odradzam.',
  blocked: 'Tego nie zrobię.',
  needs_clarification: 'Nie wiem, o które ćwiczenie chodzi.',
};

/** 1 seria, 2–4 serie, 5+ serii (and 12–14 serii). */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  if (abs === 1) return one;
  const tens = abs % 100;
  const last = abs % 10;
  return last >= 2 && last <= 4 && !(tens >= 12 && tens <= 14) ? few : many;
}
const sets = (n: number) => `${n} ${plural(n, 'seria', 'serie', 'serii')}`;
/** The count as the object of a verb: 1 serię, 2 serie, 5 serii. */
const setsObject = (n: number) => `${n} ${plural(n, 'serię', 'serie', 'serii')}`;
const minutes = (sec: number) => `${Math.max(1, Math.round(sec / 60))} min`;
const decimal = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

const num = (data: AssessmentCheck['data'], key: string): number | undefined => {
  const v = data[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};
const str = (data: AssessmentCheck['data'], key: string): string | undefined => {
  const v = data[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
};
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function muscleName(id: string | undefined): string | undefined {
  return id === undefined ? undefined : (MUSCLE[id as MuscleGroup] ?? id);
}

type Namer = (id: string) => string;
type CheckText = (c: AssessmentCheck, name: Namer) => string;

/** One sentence for each rule of the registry; the record is exhaustive on purpose. */
const CHECK_TEXT: Record<RuleCode, CheckText> = {
  NOT_IN_CATALOG: (c, name) => {
    const query = str(c.data, 'query');
    const id = str(c.data, 'exerciseId');
    return query !== undefined
      ? `Nie znam ćwiczenia „${query}”, więc nie ocenię jego bezpieczeństwa.`
      : id !== undefined
        ? `Ćwiczenia ${name(id)} nie ma w katalogu.`
        : 'Tego ćwiczenia nie ma w katalogu.';
  },
  DRAFT_ONLY: () => 'To ćwiczenie jest dopiero szkicem, bez pełnej klasyfikacji.',
  MEDICAL_EXCLUSION: () => 'To ćwiczenie jest wykluczone przez ograniczenia zdrowotne w profilu.',
  MISSING_CLASSIFICATION: () =>
    'Brakuje klasyfikacji tego ćwiczenia dla stawu z ograniczeniem, więc nie da się go ocenić.',
  PAIN_TODAY: () => 'Dziś zgłoszono ból w tej partii, więc to ćwiczenie odpada.',
  AVOIDED_BY_REQUEST: () => 'Ta partia jest dziś wyłączona na twoją prośbę.',
  REST_DAY: () => 'Ten dzień jest oznaczony jako dzień odpoczynku.',
  USER_EXCLUDED: () => 'To ćwiczenie jest na liście wykluczonych.',
  EQUIPMENT_UNAVAILABLE: () => 'Brakuje sprzętu do tego ćwiczenia.',
  UNSUPPORTED_CAPABILITY: (c) =>
    str(c.data, 'capability') === 'distance execution'
      ? 'Aplikacja nie obsługuje jeszcze ćwiczeń liczonych w dystansie.'
      : 'Aplikacja nie obsłuży jeszcze takiego sposobu obciążenia tego ćwiczenia.',
  RESISTANCE_UNREACHABLE: (c) =>
    str(c.data, 'reason') === 'no easier resistance'
      ? 'Nie ma lżejszego obciążenia niż obecne.'
      : 'Takiego obciążenia nie da się ustawić na dostępnym sprzęcie.',
  TECHNICAL_LIMIT: (c) => {
    const what = str(c.data, 'what');
    return what === 'sets' || what === 'added sets'
      ? 'Ćwiczenie może mieć od 1 do 10 serii.'
      : 'Powtórzenia albo czas są poza zakresem, który aplikacja potrafi zapisać.';
  },
  PLAN_INVALID: (c) => {
    switch (str(c.data, 'reason')) {
      case 'unknown exposure':
        return 'Nie ma już takiego ćwiczenia w planie sesji.';
      case 'no pending sets':
        return 'Nie zostały żadne niewykonane serie do zmiany.';
      case 'training date mismatch':
        return 'Plan sesji jest z innego dnia niż dzisiejszy.';
      case 'empty reduction':
        return 'Ta zmiana niczego by nie skróciła.';
      case 'cannot drop completed side or more than pending':
        return 'Nie można skrócić bardziej, niż zostało serii do zrobienia.';
      default:
        return 'Plan sesji jest niespójny, więc nie mogę ocenić zmiany.';
    }
  },
  PLAN_INTEGRITY: () => 'Plan sesji zmienił się od ostatniego sprawdzenia.',
  RECIPE_INCOMPLETE: () => 'Dla tego ćwiczenia nie da się ułożyć kompletnych serii.',
  TRACE_INCONSISTENT: () => 'Uzasadnienie recepty nie zgadza się z planem.',
  DAY_MAX_EXCEEDED: (c) => {
    const muscle = muscleName(str(c.data, 'muscle')) ?? 'Ta partia';
    const dayMax = num(c.data, 'dayMax');
    const after =
      num(c.data, 'after') ?? (num(c.data, 'done') ?? 0) + (num(c.data, 'planned') ?? 0);
    return dayMax === undefined
      ? `${sentence(muscle)} dziś przekroczą dzienny limit.`
      : `${sentence(muscle)} dziś: ${sets(after)} przy limicie ${dayMax}.`;
  },
  WEEK_MAX_EXCEEDED: (c) => {
    const muscle = muscleName(str(c.data, 'muscle')) ?? 'Ta partia';
    const weekMax = num(c.data, 'weekMax');
    const upper =
      (num(c.data, 'certain') ?? 0) +
      (num(c.data, 'uncertain') ?? 0) +
      (num(c.data, 'planned') ?? 0);
    return weekMax === undefined
      ? `${sentence(muscle)} w tym tygodniu przekroczą limit.`
      : `${sentence(muscle)} w tygodniu: do ${upper} serii przy limicie ${weekMax}.`;
  },
  RECOVERING: () => 'Główne partie tego ćwiczenia pracowały niedawno i jeszcze się regenerują.',
  DOMS_HIGH: () => 'Zakwasy w tych partiach są dziś wysokie.',
  OVERLAP_TODAY: (c, name) => {
    const other = str(c.data, 'exerciseId');
    const who = other === undefined ? 'wcześniejszym ćwiczeniem' : name(other);
    if (c.data.samePattern === true) return `Ten sam ruch zrobiono już dziś: ${who}.`;
    const shared = (str(c.data, 'sharedPrimary') ?? '')
      .split(',')
      .filter((m) => m !== '')
      .map((m) => muscleName(m)!);
    return shared.length === 0
      ? `Pracuje na tych samych mięśniach co ${who}.`
      : `Pracuje na tych samych mięśniach co ${who}: ${shared.join(', ')}.`;
  },
  TIME_OVER_BUDGET: (c) => {
    const seconds = num(c.data, 'seconds');
    const max = num(c.data, 'max');
    return seconds !== undefined && max !== undefined
      ? `Sesja wydłuży się do około ${minutes(seconds)} przy limicie ${minutes(max)}.`
      : 'Sesja przekroczy zaplanowany czas.';
  },
  RESOURCE_CONFLICT: (c) => {
    if (c.status === 'fail')
      return 'Ten sam sprzęt jest ustawiony inaczej, niż potrzeba, i nie da się go użyć naraz.';
    const setup = num(c.data, 'setupSec');
    return setup === undefined
      ? 'Trzeba będzie przezbroić sprzęt.'
      : `Trzeba będzie przezbroić sprzęt (około ${setup} s).`;
  },
  LOAD_JUMP_OVER_POLICY: () => 'Obciążenie rosłoby o więcej niż jeden szczebel naraz.',
  DELOAD_WORK_OVER_POLICY: (c) => {
    const recommended = num(c.data, 'recommended');
    const requested = num(c.data, 'requested');
    return recommended !== undefined && requested !== undefined
      ? `W tygodniu odciążenia zalecam ${setsObject(recommended)}, a nie ${requested}.`
      : 'W tygodniu odciążenia ta zmiana dodaje za dużo pracy.';
  },
  PLANNER_LIMIT: () => 'To wykracza poza zakres, w którym silnik sam układa plan.',
  HURTS_TOMORROW: (c) => {
    const slots = (str(c.data, 'slots') ?? '').split(',').filter((s) => s !== '').length;
    return slots > 0
      ? `Zmiana popsuje zapisany plan na jutro (dotyczy ${slots} ${plural(slots, 'ćwiczenia', 'ćwiczeń', 'ćwiczeń')}).`
      : 'Zmiana popsuje zapisany plan na jutro.';
  },
  SUPPLEMENTAL_ONLY: () =>
    'To ćwiczenie było dziś już zrobione, więc nowe serie są dodatkowe i nie wejdą do progresji.',
  WEEK_MIN_HELPED: (c) => {
    const muscle = muscleName(str(c.data, 'muscle')) ?? 'Ta partia';
    const before = num(c.data, 'before');
    const after = num(c.data, 'after');
    const min = num(c.data, 'min');
    return before !== undefined && after !== undefined && min !== undefined
      ? `${sentence(muscle)} w tygodniu: z ${before} do ${after} serii (minimum ${min}).`
      : `${sentence(muscle)} zbliżą się do tygodniowego minimum.`;
  },
  CALIBRATION_FIRST: () =>
    'To pierwsze podejście do tego ćwiczenia, więc obciążenie jest na próbę.',
};

/** The sentence for one finding, as it would be shown on a card. */
export function checkText(
  check: AssessmentCheck,
  name: (id: string) => string = (id) => id,
): string {
  return CHECK_TEXT[check.code](check, name);
}

const SETS_REASON: Record<SetsReason, string> = {
  POLICY_DEFAULT: '',
  USER_FIXED: '',
  PHASE_DELOAD: '',
  LIGHTER_DAY: '',
  DAY_ROOM: 'limit dnia',
  WEEK_ROOM: 'limit tygodnia',
  TIME: 'czas',
  NO_ROOM: '',
};

function loadText(p: PrescriptionSummary['perSet'][number]): string[] {
  const out: string[] = [];
  const grams = (p.resistance.value as { massGrams?: unknown }).massGrams;
  if (typeof grams === 'number' && grams > 0) out.push(`${decimal(grams / 1000)} kg`);
  const t = p.target;
  if (t.kind === 'reps') {
    const range = t.min === t.max ? `${t.min}` : `${t.min}–${t.max}`;
    out.push(
      `${range} ${plural(t.max, 'powtórzenie', 'powtórzenia', 'powtórzeń')}${t.count === 'per_side' ? ' na stronę' : ''}`,
    );
  } else if (t.kind === 'duration') {
    out.push(t.minSec === t.maxSec ? `${t.minSec} s` : `${t.minSec}–${t.maxSec} s`);
  } else {
    out.push(`${decimal(t.targetMeters)} m`);
  }
  return out;
}

function prescriptionText(p: PrescriptionSummary): string {
  const distinct = [...new Set(p.perSet.map((s) => loadText(s).join(', ')))];
  return `Recepta: ${sets(p.sets)}, ${distinct.join('; ')}.`;
}

function recommendationText(a: ChangeAssessment): string | null {
  const rec = a.recommendation;
  if (rec === null) return null;
  if (rec.sets.recommended === 0) {
    const why = [...new Set(rec.sets.reasons.map((r) => SETS_REASON[r]).filter((r) => r !== ''))];
    return why.length === 0
      ? 'Silnik nie widzi dziś miejsca na to ćwiczenie.'
      : `Silnik nie widzi dziś miejsca na to ćwiczenie (${why.join(', ')}).`;
  }
  const where = rec.position === 'end' ? ' na końcu sesji' : ' jako następne';
  const room =
    rec.sets.allowed !== null && rec.sets.allowed[1] > rec.sets.recommended
      ? ` (mieści się do ${rec.sets.allowed[1]})`
      : '';
  return `Zalecam ${setsObject(rec.sets.recommended)}${where}${room}.`;
}

function alternativesText(
  alternatives: readonly RankedAlternative[],
  name: Namer,
  max: number,
): string | null {
  const shown = alternatives.slice(0, max);
  if (shown.length === 0) return null;
  const items = shown.map((alt) => {
    const mark = alt.verdict === 'not_recommended' ? ', odradzane' : '';
    return `${name(alt.exerciseId)} (${sets(alt.prescription.sets)}${mark})`;
  });
  return `Zamiast tego: ${items.join('; ')}.`;
}

function candidatesText(candidates: readonly ExerciseMatch[]): string | null {
  return candidates.length === 0 ? null : `Do wyboru: ${candidates.map((c) => c.name).join('; ')}.`;
}

const FEEL_OPTION: Record<FeelOption['why'], string> = {
  easier_resistance: 'lżejsze obciążenie na pozostałe serie',
  variant_easier: 'łatwiejszy wariant ćwiczenia',
  drop_set: 'o jedną serię mniej',
  skip_remaining: 'pominięcie reszty ćwiczenia',
  add_set: 'jedna seria więcej',
  next_prescription: 'zostawić plan i następnym razem dać trudniej',
};
const REDUCING: readonly FeelOption['why'][] = ['easier_resistance', 'variant_easier', 'drop_set'];

function optionText(o: FeelOption): string {
  const v = o.assessment.verdict;
  const mark = v === 'not_recommended' ? ' (odradzane)' : v === 'blocked' ? ' (niedostępne)' : '';
  return `${FEEL_OPTION[o.why]}${mark}`;
}

function feelText(a: ChangeAssessment): string[] {
  const feel = a.feel!;
  const easy = feel.options.some((o) => o.why === 'add_set' || o.why === 'next_prescription');
  const out = [easy ? 'Przyjęto: za lekko.' : 'Przyjęto: za ciężko.'];
  const chosen = feel.options.filter((o) => feel.recommendedOptionIds.includes(o.id));
  const rest = feel.options.filter((o) => !feel.recommendedOptionIds.includes(o.id));
  if (chosen.length > 0) out.push(`Polecam: ${chosen.map(optionText).join('; ')}.`);
  if (rest.length > 0) out.push(`Inne możliwości: ${rest.map(optionText).join('; ')}.`);
  if (chosen.some((o) => REDUCING.includes(o.why)))
    out.push('Skrócenie na twoją prośbę nie liczy się jako porażka siłowa.');
  return out;
}

/**
 * The card of an assessment as plain Polish sentences, most important first.
 * Deterministic: the same assessment and names always give the same text.
 */
export function assessmentText(
  assessment: ChangeAssessment,
  options: AssessmentTextOptions = {},
): string[] {
  if (assessment.feel !== undefined) return feelText(assessment);
  const name: Namer = (id) => options.exerciseName?.(id) ?? id;
  const out: string[] = [VERDICT[assessment.verdict]];

  if (assessment.resolved.kind === 'ambiguous') {
    const pick = candidatesText(assessment.resolved.candidates);
    if (pick !== null) out.push(pick);
    return out;
  }

  const shown = sortChecks(assessment.checks).filter(
    (c) => c.status !== 'pass' || c.class === 'info',
  );
  for (const c of shown) out.push(checkText(c, name));

  const rec = recommendationText(assessment);
  if (rec !== null) out.push(rec);
  if (assessment.prescription !== null && assessment.verdict !== 'blocked')
    out.push(prescriptionText(assessment.prescription));
  const alts = alternativesText(assessment.alternatives, name, options.maxAlternatives ?? 2);
  if (alts !== null) out.push(alts);
  return out;
}
