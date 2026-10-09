/**
 * Polish sentences for the reasons of a prescription (engine v2, 03 §10, P3.5).
 *
 * The answer to "why this weight?": one sentence for each code of the closed
 * registry, from the code and, where the rule left them, the numbers of its
 * evidence. The record is exhaustive, so a rule that adds a code does not
 * compile until it can be explained. A sentence says what the engine did and
 * the one thing that made it do it; it names no number the evidence did not
 * carry and never says "lighter" for a resistance that did not change (D39 e).
 */
import type { DecisionTrace } from '../plan/planV2';
import { DECISION_CODES, type DecisionCode } from './codes';

type Evidence = Readonly<Record<string, unknown>>;

const count = (e: Evidence, key: string): number | undefined => {
  const v = e[key];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
};
const days = (n: number) => `${n} ${n === 1 ? 'dzień' : 'dni'}`;

const TEXT: Record<DecisionCode, (e: Evidence) => string> = {
  FIRST_COMPARABLE_EXPOSURE: () =>
    'Pierwszy raz z tym ćwiczeniem w tym ustawieniu, więc zaczynamy od dołu zakresu z zapasem powtórzeń.',
  INTRO_EXPOSURE: () => 'Wprowadzenie: pierwsze podejścia służą do wyczucia ciężaru, bez awansu.',
  INCOMPLETE_PLANNED_SETS: () =>
    'Ostatnio nie zrobiono wszystkich zaplanowanych serii, więc nie ma podstaw do zmiany.',
  MISSING_SIDE: () => 'Ostatnio brakowało jednej ze stron, więc nie ma podstaw do zmiany.',
  MISSING_EFFORT_EVIDENCE: () =>
    'Brakuje zapisanego zapasu powtórzeń z ostatniego razu, a bez niego nie podnosimy obciążenia.',
  UNCONFIRMED_ACTUAL: () =>
    'Ostatni wynik nie został potwierdzony, więc nie liczy się jako dowód do zmiany.',
  PRESCRIPTION_DEVIATION: () =>
    'Ostatnio zrobiono coś innego, niż zaplanowano, więc ten wynik nie wystarcza do zmiany.',
  CONTEXT_CONFOUNDED: () =>
    'Ostatni raz wypadł w niesprzyjających warunkach (krótka przerwa albo zakwasy), więc powtarzamy.',
  PAIN_REPORTED: () => 'Ostatnio zgłoszono ból, więc obciążenie zostaje bez zmiany.',
  USER_REDUCED: () =>
    'Ostatnio skrócono ćwiczenie na twoją prośbę. To nie jest porażka, ale też nie podstawa do awansu.',
  LOAD_STEP_UP: () => 'Zakres osiągnięty z zapasem, więc o jeden szczebel więcej.',
  LOAD_STEP_DOWN: (e) => {
    const n = count(e, 'failures');
    return n === undefined || n < 2
      ? 'Kolejny raz poniżej zakresu, więc o jeden szczebel lżej.'
      : `Poniżej zakresu ${n} razy z rzędu, więc o jeden szczebel lżej.`;
  },
  LOAD_CEILING: () =>
    'To największe dostępne obciążenie, więc dokładamy powtórzenia zamiast zwiększać ciężar.',
  AT_MINIMUM: () => 'To już najlżejsze dostępne obciążenie, więc zostaje.',
  RIR_TOO_LOW: () =>
    'Zakres osiągnięty, ale z za małym zapasem powtórzeń, więc obciążenie zostaje.',
  REP_PROGRESSION: () => 'Dokładamy powtórzenia w zakresie, zanim zwiększymy obciążenie.',
  LAYOFF_REPEAT: (e) => {
    const n = count(e, 'gapDays');
    return n === undefined
      ? 'Po krótkiej przerwie powtarzamy ostatnią receptę.'
      : `Po przerwie (${days(n)}) powtarzamy ostatnią receptę.`;
  },
  LAYOFF_STEP_DOWN: (e) => {
    const n = count(e, 'gapDays');
    return n === undefined
      ? 'Po dłuższej przerwie wracamy o jeden szczebel lżej.'
      : `Po przerwie (${days(n)}) wracamy o jeden szczebel lżej.`;
  },
  RE_EXPOSURE: (e) => {
    const n = count(e, 'gapDays');
    return n === undefined
      ? 'Tego ćwiczenia dawno nie było, więc wracamy lżej i od dołu zakresu.'
      : `Tego ćwiczenia nie było od ${days(n)}, więc wracamy lżej i od dołu zakresu.`;
  },
  RECALIBRATION: () => 'Po długiej przerwie ustalamy obciążenie od nowa, bez awansu.',
  DELOAD: () => 'Tydzień odciążenia: mniej pracy i większy zapas, żeby się zregenerować.',
  RUNG_RECENTLY_FAILED: () =>
    'Ten szczebel niedawno się nie udał, więc najpierw wydłużamy zakres albo dokładamy serię.',
  PROBE_PLANNED: () => 'Pierwsza seria to próba wyższego szczebla; pozostałe zostają na obecnym.',
  PROBE_PASSED: () => 'Próba wyższego szczebla się udała, więc od teraz cała ekspozycja na nim.',
  PROBE_FAILED: () => 'Próba wyższego szczebla się nie udała, więc zostajemy na poprzednim.',
  PROBE_COOLDOWN: () => 'Próba niedawno się nie udała, więc chwilę poczekamy z kolejną.',
  NO_ROOM_FOR_PROBE: () =>
    'Nie ma dziś miejsca na próbną serię, więc zostajemy na obecnym szczeblu.',
  REP_CAP_REACHED: () =>
    'Górna granica powtórzeń osiągnięta, więc czas na cięższy szczebel albo trudniejszy wariant.',
  VARIANT_UP_SUGGESTED: () => 'Warto rozważyć trudniejszy wariant tego ćwiczenia.',
  BUILDUP_BELOW_RANGE: () =>
    'Wynik jest poniżej zakresu, a lżejszego oporu nie ma, więc dochodzimy do zakresu krok po kroku.',
  VARIANT_DOWN_SUGGESTED: () => 'Warto rozważyć łatwiejszy wariant tego ćwiczenia.',
  NO_EASIER_VARIANT: () => 'Łatwiejszego wariantu nie ma, więc zostajemy przy tym ćwiczeniu.',
  FEEL_TOO_HARD: () =>
    'Zakres osiągnięty, ale zgłoszono, że było za ciężko, więc obciążenie zostaje.',
  FEEL_TOO_EASY: () => 'Zgłoszono, że było za lekko, więc dokładamy szybciej.',
  CONFIRM_STEP_UP: () => 'Szło dobrze kilka razy z rzędu, więc pytamy, czy podnosimy.',
  USER_DEFERRED: () => 'Na twoją prośbę czekamy z podniesieniem.',
  CALIBRATION_STEP: () => 'Kalibracja w sesji: o jeden szczebel wyżej.',
  CALIBRATION_STEP_DOWN: () => 'Kalibracja w sesji: o jeden szczebel niżej.',
  ROTATION_CONTINUITY: () => 'Ten wariant działał w poprzednim bloku, więc zostaje.',
  INSUFFICIENT_ROTATION_EVIDENCE: () =>
    'Za mało podejść, żeby ocenić ten wariant, więc zostaje na kolejny blok.',
  FILLER: () => 'Uzupełnienie dnia. Nie wpływa na progresję.',
  NOT_PRESCRIBED: () => 'Dla tego ćwiczenia silnik nie przepisuje obciążenia.',
  MODEL_NOT_APPLICABLE: () => 'Dla tego sprzętu silnik nie liczy obciążenia.',
};

/** The sentence for one code, with the numbers of the evidence when it has them. */
export function decisionText(code: DecisionCode, evidence: Evidence = {}): string {
  return TEXT[code](evidence);
}

const KNOWN: ReadonlySet<string> = new Set(DECISION_CODES);

/**
 * The reasons of a trace, the one that decided first: the codes the pipeline
 * recorded, each once. A code the registry does not know (a plan from a newer
 * engine) is skipped rather than shown as a raw identifier.
 */
export function traceText(trace: Pick<DecisionTrace, 'code' | 'evidence'>): string[] {
  const recorded = Array.isArray(trace.evidence.codes) ? (trace.evidence.codes as unknown[]) : [];
  const codes = [trace.code, ...recorded].filter(
    (c, i, all): c is DecisionCode => typeof c === 'string' && KNOWN.has(c) && all.indexOf(c) === i,
  );
  return codes.map((c) => decisionText(c, trace.evidence));
}
