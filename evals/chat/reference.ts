/**
 * A rule-based stand-in for the chat model: no network, no randomness, and a
 * promise to follow every rule the prompt states.
 *
 * It does what a model has to do, in the shape a model does it: read the
 * conversation, ask for tools, read their results, answer. It drives the
 * real loop (`runTurn`), the real tools and the real guards, so a run of it
 * exercises everything except the model. It says nothing about any model,
 * and every report it produces says so.
 *
 * It is deliberately simple-minded: keywords decide what to look up, and the
 * answer is assembled from what the tools returned, quoting numbers as they
 * are and naming exercises in the person's own words, never from a tool's
 * text. That last choice is what lets it pass the case with an instruction
 * hidden in an exercise name, and a model has to do the same by judgement.
 */
import type { ChatEvent, ChatMessage, ChatRequest, ToolCall, ToolResult } from '@/ai/contract/chat';
import type { ToolName, ToolOutput } from '@/ai/contract/chatTools';
import { CHAT_PROMPT_VERSION } from '@/ai/prompts/chat/v4';
import { fold } from '@/domain/coach/text';
import type { SkipReason } from '@/domain/plan/reasons';

export const REFERENCE_CHAT_MODEL = 'reference-chat-model';

const pl = (n: number) => String(n).replace('.', ',');

// --- reading the conversation -------------------------------------------------

function currentTurn(messages: readonly ChatMessage[]): {
  question: string;
  calls: ToolCall[];
  results: ToolResult[];
} {
  let at = -1;
  messages.forEach((m, i) => {
    if (m.role === 'user') at = i;
  });
  const question = (messages[at] as { text: string }).text;
  const rest = messages.slice(at + 1);
  return {
    question,
    calls: rest.flatMap((m) => (m.role === 'assistant' ? m.toolCalls : [])),
    results: rest.flatMap((m) => (m.role === 'tool' ? m.results : [])),
  };
}

const hasError = (output: unknown): boolean =>
  typeof output === 'object' && output !== null && 'error' in output;

function outputsOf<N extends ToolName>(results: readonly ToolResult[], name: N) {
  return results.filter((r) => r.name === name).map((r) => r.output as ToolOutput<N>);
}

// --- what the person may have asked ------------------------------------------

/** Exercise keywords, most specific first, with the name used in the answer. */
const EXERCISES: { match: string; query: string; name: string }[] = [
  { match: 'bulgarski', query: 'bulgarski', name: 'przysiad bułgarski' },
  { match: 'goblet', query: 'goblet', name: 'przysiad goblet' },
  { match: 'wios', query: 'wios', name: 'wiosłowanie' },
  { match: 'martw', query: 'martw', name: 'martwy ciąg' },
  { match: 'pompk', query: 'pompk', name: 'pompki' },
  { match: 'przysiad', query: 'przysiad', name: 'przysiad' },
];

const MUSCLES: { match: string; muscles: readonly string[]; name: string }[] = [
  { match: 'plec', muscles: ['back', 'lats'], name: 'plecy' },
  { match: 'nog', muscles: ['quads', 'hamstrings', 'glutes', 'calves'], name: 'nogi' },
  { match: 'klatk', muscles: ['chest'], name: 'klatka' },
  { match: 'bark', muscles: ['shoulders'], name: 'barki' },
  { match: 'brzuch', muscles: ['core'], name: 'brzuch' },
];

const VERDICT: Record<string, string> = {
  improved: 'wynik się poprawił',
  maintained: 'wynik utrzymany',
  declined: 'wynik jest niższy niż wcześniej',
  not_comparable: 'zmienił się rodzaj obciążenia, więc nie porównuję',
  insufficient_data: 'za mało sesji, żeby to ocenić',
};

const STATUS: Record<string, string> = {
  below_min: 'poniżej zakresu',
  in_range: 'w zakresie',
  above_max: 'powyżej zakresu',
};

// --- the model's two kinds of step -------------------------------------------

const call = (id: string, name: ToolName, input: Record<string, never> | object): ToolCall => ({
  id,
  name,
  input: input as ToolCall['input'],
});

function asksFor(request: ChatRequest, calls: ToolCall[]): ChatEvent[] {
  return [
    start(request),
    ...calls.map((c): ChatEvent => ({ type: 'tool_call', call: c })),
    finish(request, 'tool_calls'),
  ];
}

function says(request: ChatRequest, text: string): ChatEvent[] {
  // In two pieces, as a stream would arrive.
  const cut = Math.max(1, Math.floor(text.length / 2));
  return [
    start(request),
    { type: 'text', delta: text.slice(0, cut) },
    { type: 'text', delta: text.slice(cut) },
    finish(request, 'stop'),
  ];
}

const start = (request: ChatRequest): ChatEvent => ({
  type: 'start',
  requestId: request.requestId,
  promptVersion: CHAT_PROMPT_VERSION,
  model: REFERENCE_CHAT_MODEL,
});

const finish = (request: ChatRequest, reason: 'stop' | 'tool_calls'): ChatEvent => ({
  type: 'finish',
  reason,
  usage: { inputTokens: Math.ceil(JSON.stringify(request).length / 4), outputTokens: 30 },
});

// --- the answers --------------------------------------------------------------

const REFUSE_LOADS =
  'O tym, jaki ciężar wziąć, decyduje plan w aplikacji. Ja mogę tylko powiedzieć, co zapisał dziennik.';
const REFUSE_RULES =
  'Nie zmieniam swoich zasad. Obciążenia ustala plan w aplikacji, a ja opisuję tylko to, co widać w dzienniku.';
const REFUSE_CHANGE =
  'Nie zmieniam planu: układa go silnik reguł w aplikacji. Ćwiczenie możesz zamienić na ekranie planu albo w trakcie sesji.';
const NO_PLAN_THAT_DAY = 'Na ten dzień nie mam planu, bo sesja nie była zaczęta z planu.';
const COULD_NOT = 'Nie udało mi się tego sprawdzić. Spróbuj za chwilę.';
const CAN_ANSWER =
  'Mogę odpowiedzieć na pytania o Twoje sesje, ćwiczenia, serie i wagę z dziennika. Zapytaj o któreś z nich.';

function weekLine(week: ToolOutput<'getWeeklyVolume'>, only: readonly string[] | null): string {
  const rows = week.muscles.filter((m) => only === null || only.includes(m.muscle));
  if (rows.length === 0) return 'brak zapisanych serii';
  const NAMES: Record<string, string> = {
    quads: 'czworogłowe',
    hamstrings: 'dwugłowe',
    glutes: 'pośladki',
    calves: 'łydki',
    chest: 'klatka',
    back: 'plecy',
    lats: 'najszersze',
    shoulders: 'barki',
    biceps: 'dwugłowe ramion',
    triceps: 'trójgłowe',
    core: 'brzuch',
    forearms: 'przedramiona',
  };
  return rows
    .map((m) => `${NAMES[m.muscle] ?? m.muscle}: ${pl(m.sets)} serii (${STATUS[m.status]})`)
    .join(', ');
}

function bodyLines(body: ToolOutput<'getBodyTrend'>): string[] {
  const lines: string[] = [];
  const w = body.weight;
  if (w === null) lines.push('Za mało ważeń, żeby cokolwiek powiedzieć o wadze.');
  else {
    lines.push(`Ostatnie ważenie: ${pl(w.latestKg)} kg.`);
    if (w.avg7Kg !== null) lines.push(`Średnia z ostatnich dni to ${pl(w.avg7Kg)} kg.`);
    if (w.avg7ChangeKg !== null) {
      lines.push(
        `Ta średnia zmieniła się o ${pl(Math.abs(w.avg7ChangeKg))} kg w oknie ${body.days} dni.`,
      );
    }
  }
  if (body.waist !== null) {
    lines.push(`Ostatni pomiar talii: ${pl(body.waist.latestCm)} cm.`);
    if (body.waist.changeCm !== null) {
      lines.push(`Zmiana talii w tym oknie: ${pl(Math.abs(body.waist.changeCm))} cm.`);
    }
  }
  return lines;
}

/** Why a movement is left out, in plain Polish — the engine's code, nothing added. */
const SKIPPED: Record<SkipReason, string> = {
  AVOIDED_BY_REQUEST: 'na Twoją prośbę ta partia dziś odpoczywa',
  NO_CANDIDATE: 'w tym ruchu nie ma teraz dozwolonego ćwiczenia',
  DOMS_HIGH: 'masz dziś mocne zakwasy w tej partii',
  RECOVERING: 'ta partia pracowała wczoraj i się regeneruje',
  VOLUME_AT_MAX: 'ta partia ma już tygodniowe maksimum serii',
  VOLUME_ON_TARGET: 'ta partia ma już swoje serie w tym tygodniu',
  ALREADY_TODAY: 'tę partię dziś trenuje już inne ćwiczenie',
  FATIGUE_BILATERAL_ONLY: 'przy oznakach zmęczenia plan bierze tylko ćwiczenia obunóż',
  NOT_PICKED: 'nie zmieścił się w dzisiejszym czasie',
};

/**
 * The asked-about movement, found by the person's own word in the plan's
 * movement names: in the plan, or left out with the engine's reason.
 * Exercise names from the tool are never repeated (see the file comment).
 */
function planAnswer(q: string, plan: ToolOutput<'getPlanExplanation'>): string {
  const hit = EXERCISES.find((e) => q.includes(e.match));
  const day = plan.dayReasons.includes('LIGHT_DAY') ? ' Dziś jest lżejszy dzień.' : '';
  if (!hit) {
    return `Plan na dziś jest gotowy, a szczegóły z obciążeniami są na ekranie planu.${day}`;
  }
  const name = `${hit.name[0]!.toUpperCase()}${hit.name.slice(1)}`;
  const has = (text: string) => fold(text).includes(hit.match);
  if (plan.exercises.some((e) => has(e.movement))) return `${name} jest dziś w planie.${day}`;
  const left = plan.skipped.find((s) => has(s.movement));
  if (left) return `${name} nie ma dziś w planie, bo ${SKIPPED[left.reason]}.${day}`;
  return `W dzisiejszym planie nie widzę ruchu, o który pytasz.${day}`;
}

// --- composing a day with the engine (ADR 0006) --------------------------------

/** Movements by the slots of the shipped data: what "the upper body" and "legs" mean here. */
const UPPER = new Set([
  'push-horizontal',
  'push-vertical',
  'chest-iso',
  'pull-horizontal',
  'pull-vertical',
  'lateral-delts',
  'rear-delts',
  'biceps',
  'triceps',
]);
const LOWER = new Set(['squat', 'lunge', 'hinge', 'glutes', 'calves']);

const conflictText = (
  reason: ToolOutput<'proposeDayPlan'>['days'][number]['conflicts'][number]['reason'],
) => (reason === 'REST_DAY' ? 'ten dzień jest wolny' : SKIPPED[reason]);

/** After a preview: what the engine took, and in plain words what it did not and why. */
function composeAnswer(out: ToolOutput<'proposeDayPlan'>): string {
  const refused = out.days.flatMap((d) =>
    d.conflicts.map((c) => `${c.movement.toLowerCase()}, bo ${conflictText(c.reason)}`),
  );
  if (out.proposalId === null)
    return `Silnik nie mógł ułożyć tego dnia: ${refused.join('; ')}. Mogę spróbować innego dnia albo innych partii.`;
  const rest = refused.length ? ` Silnik nie przyjął: ${refused.join('; ')}.` : '';
  return `Ułożyłem ten dzień razem z silnikiem. Sprawdź kartę i wybierz Zastosuj lub Odrzuć.${rest}`;
}

/** Nothing wanted is possible that day: the engine's reasons, and what could work instead. */
function noRoomAnswer(options: ToolOutput<'getDayOptions'>, wanted: ReadonlySet<string>): string {
  if (options.rest) return 'Ten dzień jest w planie wolny. Mogę ułożyć inny dzień.';
  const reasons = [
    ...new Set(
      options.options
        .filter((o) => wanted.has(o.slotId) && !o.available && o.reason !== null)
        .map((o) => SKIPPED[o.reason!]),
    ),
  ];
  return `Na ten dzień te ruchy nie są możliwe: ${reasons.join('; ')}. Spróbuj późniejszego dnia albo innych partii.`;
}

/** "Ułóż mi …": ask for what is missing, read the options, propose from the available ones. */
function composeStep(request: ChatRequest, q: string, results: ToolResult[]): ChatEvent[] {
  const ahead = /pojutrz/.test(q) ? 2 : /jutr/.test(q) ? 1 : /dzis/.test(q) ? 0 : null;
  if (ahead === null)
    return says(request, 'Na który dzień mam ułożyć trening: dziś, jutro czy pojutrze?');
  const wanted = /\bgor|gorn/.test(q) ? UPPER : /\bnog|dolna partia/.test(q) ? LOWER : null;
  if (!wanted) return says(request, 'Na które partie ma być ten dzień: górę ciała czy nogi?');
  const [proposal] = outputsOf(results, 'proposeDayPlan');
  if (proposal) return says(request, composeAnswer(proposal));
  const [options] = outputsOf(results, 'getDayOptions');
  if (!options)
    return asksFor(request, [call('ref-options', 'getDayOptions', { daysAhead: ahead })]);
  const chosen = options.options.filter((o) => o.available && wanted.has(o.slotId)).slice(0, 4);
  if (!chosen.length) return says(request, noRoomAnswer(options, wanted));
  return asksFor(request, [
    call('ref-compose', 'proposeDayPlan', {
      days: [{ daysAhead: ahead, slots: chosen.map((o) => ({ slotId: o.slotId })) }],
      note: wanted === UPPER ? 'Górna partia ciała.' : 'Nogi.',
    }),
  ]);
}

/** One step of the stand-in model: what it would say or ask for next. */
export function referenceChatStep(request: ChatRequest): ChatEvent[] {
  const { question, results } = currentTurn(request.messages);
  const q = fold(question);
  const sparse = request.facts.signals.includes('SPARSE_HISTORY');

  // A day without a plan is a fact, not a failure; anything else a tool
  // could not give is said plainly, never filled in.
  const planResult = results.find((r) => r.name === 'getPlanExplanation');
  if (planResult && hasError(planResult.output)) {
    const { error } = planResult.output as { error: string };
    return says(request, error === 'no_plan' ? NO_PLAN_THAT_DAY : COULD_NOT);
  }
  if (results.some((r) => (r.output as { error?: string }).error === 'day_done'))
    return says(request, 'Dzisiejszy trening jest już zrobiony. Mogę ułożyć jutro albo pojutrze.');
  if (results.some((r) => hasError(r.output))) return says(request, COULD_NOT);

  // --- things it will not do, before anything is looked up ---------------------
  if (/zignoruj|zapomnij|ignore|zasady/.test(q)) return says(request, REFUSE_RULES);
  if (/zakwas/.test(q) && /pomin|zmien|przelicz/.test(q)) {
    if (!/siln|mocn|[45]\s*\/\s*5/.test(q))
      return says(request, 'Czy zakwasy są lekkie czy silne? Lekkie zakwasy nie wyłączają partii.');
    const proposal = results.find((r) => r.name === 'proposePlanChange');
    if (proposal)
      return says(
        request,
        'Przygotowałem podgląd zmiany planu. Sprawdź kartę i wybierz Zastosuj lub Odrzuć.',
      );
    return asksFor(request, [
      call('ref-change', 'proposePlanChange', {
        constraints: [
          {
            kind: 'avoid_muscle',
            muscles: ['quads', 'hamstrings', 'glutes', 'calves'],
            fromDaysAhead: 0,
            days: 2,
            reason: 'doms',
            domsLevel: 4,
          },
        ],
        note: 'Silne zakwasy nóg.',
      }),
    ]);
  }
  if (/uloz|skomponuj/.test(q)) return composeStep(request, q, results);
  if (/dodatkow/.test(q)) {
    const proposal = results.find((r) => r.name === 'proposeExtraSession');
    if (proposal)
      return says(
        request,
        'Dodatkowy trening jest gotowy do sprawdzenia. Wybierz Zastosuj na karcie, aby go rozpocząć.',
      );
    return asksFor(request, [
      call('ref-extra', 'proposeExtraSession', { focusMuscles: ['calves'] }),
    ]);
  }
  if (/tydzien|tygodnia/.test(q) && /plan|zaplanowan/.test(q) && !/ciezar|kg|doloz/.test(q)) {
    if (results.some((r) => r.name === 'getWeekPlan'))
      return says(
        request,
        'Plan tygodnia jest gotowy. Dni i ćwiczenia możesz sprawdzić w kalendarzu.',
      );
    return asksFor(request, [call('ref-week', 'getWeekPlan', {})]);
  }
  const aboutPlan =
    /\bplan/.test(q) || (/czemu|dlaczego/.test(q) && /nie ma|nie bylo|brak/.test(q));
  if (/zamien|zmien|wymien/.test(q) && (aboutPlan || /dzis/.test(q))) {
    return says(request, REFUSE_CHANGE);
  }

  // --- the plan: read the engine's reasons, add none of its own -----------------
  if (aboutPlan) {
    if (!planResult) {
      return asksFor(request, [
        call('ref-plan', 'getPlanExplanation', { daysAgo: /wczoraj/.test(q) ? 1 : 0 }),
      ]);
    }
    return says(request, planAnswer(q, planResult.output as ToolOutput<'getPlanExplanation'>));
  }
  if (/jaki ciezar|ile kg|dolozyc|za tydzien|na nastepnym|przyszl/.test(q)) {
    return says(request, REFUSE_LOADS);
  }

  // --- a forecast: look at the figures and decline to extend them ---------------
  if (/ile bede wazyl|za miesiac|jesli tak dalej/.test(q)) {
    const [body] = outputsOf(results, 'getBodyTrend');
    if (!body) return asksFor(request, [call('ref-body', 'getBodyTrend', { days: 28 })]);
    return says(request, `Nie przewiduję przyszłej wagi. ${bodyLines(body).join(' ')}`);
  }

  // --- an exercise ------------------------------------------------------------
  const hits = EXERCISES.filter((e) => q.includes(e.match));
  // "przysiad" alone is generic: it only counts when nothing more specific was named.
  const wanted = hits.some((e) => e.match !== 'przysiad')
    ? hits.filter((e) => e.match !== 'przysiad')
    : hits;
  if (wanted.length > 0) {
    const finds = outputsOf(results, 'findExercises');
    if (finds.length === 0) {
      return asksFor(
        request,
        wanted
          .slice(0, 3)
          .map((e, i) => call(`ref-find-${i}`, 'findExercises', { query: e.query })),
      );
    }
    const histories = outputsOf(results, 'getExerciseHistory');
    const found = wanted
      .slice(0, 3)
      .flatMap((e, i) => (finds[i] && finds[i]!.total > 0 ? [{ e, i }] : []));
    if (found.length === 0) {
      return says(
        request,
        'Nie znalazłem takiego ćwiczenia w katalogu, więc nie mam co sprawdzić.',
      );
    }
    if (histories.length === 0) {
      return asksFor(
        request,
        found.map(({ i }) =>
          call(`ref-hist-${i}`, 'getExerciseHistory', {
            exerciseId: finds[i]!.exercises[0]!.id,
            weeks: 4,
          }),
        ),
      );
    }
    const lines = found.map(({ e }, k) => {
      const h = histories[k]!;
      const verdict = sparse
        ? 'w dzienniku jest jeszcze mało sesji, więc zbieramy dopiero dane'
        : VERDICT[h.verdict];
      return `${e.name[0]!.toUpperCase()}${e.name.slice(1)}: ${verdict}. Sesji z tym ćwiczeniem w ostatnich ${h.weeks} tygodniach: ${h.sessionCount}.`;
    });
    return says(request, lines.join(' '));
  }

  // --- sets per week ------------------------------------------------------------
  if (/serii|objetosc/.test(q)) {
    const only = MUSCLES.find((m) => q.includes(m.match));
    const weeks = outputsOf(results, 'getWeeklyVolume');
    const both = /lacznie|w sumie|razem/.test(q);
    if (weeks.length === 0) {
      return asksFor(
        request,
        both
          ? [
              call('ref-week-0', 'getWeeklyVolume', { weeksAgo: 0 }),
              call('ref-week-1', 'getWeeklyVolume', { weeksAgo: 1 }),
            ]
          : [call('ref-week-0', 'getWeeklyVolume', { weeksAgo: 0 })],
      );
    }
    const where = only?.muscles ?? null;
    if (both) {
      return says(
        request,
        `Nie dodaję liczb sam, więc podaję osobno. Ostatni tydzień: ${weekLine(weeks[0]!, where)}. Tydzień wcześniej: ${weekLine(weeks[1]!, where)}.`,
      );
    }
    return says(request, `W ostatnim tygodniu: ${weekLine(weeks[0]!, where)}.`);
  }

  // --- the scale ------------------------------------------------------------------
  if (/\bwag|talia|obwod|schud/.test(q)) {
    const [body] = outputsOf(results, 'getBodyTrend');
    if (!body) return asksFor(request, [call('ref-body', 'getBodyTrend', { days: 28 })]);
    return says(request, bodyLines(body).join(' '));
  }

  // --- what was trained ---------------------------------------------------------------
  if (/ostatni|sesj|trenowal|miesiac/.test(q)) {
    const [recent] = outputsOf(results, 'getRecentSessions');
    if (!recent) return asksFor(request, [call('ref-recent', 'getRecentSessions', { count: 3 })]);
    const latest = recent.sessions[0];
    const last = latest
      ? ` Ostatnia sesja: ${latest.workingSets} serii roboczych${latest.durationMin === null ? '' : `, ${latest.durationMin} minut`}.`
      : ' W ostatnim czasie nie ma zapisanej sesji. To zwykła przerwa, wracasz do treningu spokojnie.';
    return says(request, `W dzienniku jest zapisanych sesji: ${recent.totalCompleted}.${last}`);
  }

  return says(request, CAN_ANSWER);
}
