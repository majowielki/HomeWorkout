import { assessSessionChange } from '../session/assess';
import { assessmentText, checkText, plural } from '../session/assessmentText';
import type { AssessmentCheck, CheckData, CheckStatus, Verdict } from '../policy/hardAdvice';
import { RULE_CODES, RULE_CLASS, finding } from '../policy/hardAdvice';
import type { ChangeAssessment, FeelChange, PrescriptionSummary } from '../session/types';
import { CATALOG } from './dayFixtures';
import { recipe, world, perform } from './sessionChangeFixtures';

const names = (id: string) => CATALOG[id]?.name;
const text = (a: ChangeAssessment) => assessmentText(a, { exerciseName: names });
const BAD = /undefined|NaN|\[object|null|Infinity/;

/** Representative data for each rule, as the planner, audit and assessment really produce it. */
const DATA: Partial<Record<(typeof RULE_CODES)[number], CheckData>> = {
  NOT_IN_CATALOG: { query: 'wyciskanie zza głowy' },
  DAY_MAX_EXCEEDED: { muscle: 'shoulders', done: 3, planned: 2, after: 5, dayMax: 3 },
  WEEK_MAX_EXCEEDED: { muscle: 'glutes', certain: 8, uncertain: 2, planned: 3, weekMax: 12 },
  OVERLAP_TODAY: { exerciseId: 'crunch', sharedPrimary: 'core', samePattern: true },
  TIME_OVER_BUDGET: { seconds: 2700, max: 2400 },
  RESOURCE_CONFLICT: { resources: 'plates', setupSec: 45 },
  DELOAD_WORK_OVER_POLICY: { requested: 3, recommended: 2 },
  HURTS_TOMORROW: { date: '2026-10-10', slots: 'push-vertical,core-front', reasons: 'DAY_MAX' },
  WEEK_MIN_HELPED: { muscle: 'back', before: 4, after: 6, min: 8 },
  TECHNICAL_LIMIT: { what: 'added sets', value: 11 },
  PLAN_INVALID: { reason: 'unknown exposure' },
  UNSUPPORTED_CAPABILITY: { capability: 'distance execution' },
  RESISTANCE_UNREACHABLE: { reason: 'no easier resistance' },
};

describe('P4b.6: every rule of the registry has a Polish sentence', () => {
  it('covers the whole registry, for each status, with and without data', () => {
    for (const code of RULE_CODES) {
      for (const status of ['pass', 'warn', 'fail'] as CheckStatus[]) {
        for (const data of [DATA[code] ?? {}, {}]) {
          const sentence = checkText(finding(code, status, data), (id) => id);
          expect(sentence).toMatch(/^\p{Lu}.*[.]$/u);
          expect(sentence).not.toMatch(BAD);
        }
      }
    }
  });

  it('T72 snapshot: the sentence of each code with its usual data', () => {
    const out: Record<string, string> = {};
    for (const code of RULE_CODES) {
      const status: CheckStatus = RULE_CLASS[code] === 'info' ? 'pass' : 'fail';
      out[`${code} ${status}`] = checkText(finding(code, status, DATA[code] ?? {}), names as never);
    }
    out['RESOURCE_CONFLICT warn'] = checkText(
      finding('RESOURCE_CONFLICT', 'warn', DATA.RESOURCE_CONFLICT),
      (id) => id,
    );
    out['OVERLAP_TODAY warn'] = checkText(
      finding('OVERLAP_TODAY', 'warn', {
        exerciseId: 'crunch',
        sharedPrimary: 'core,glutes',
        samePattern: false,
      }),
      names as never,
    );
    expect(out).toMatchSnapshot();
  });

  it('names an exercise missing from the catalogue, and a muscle it has no word for', () => {
    expect(
      checkText(finding('NOT_IN_CATALOG', 'fail', { exerciseId: 'crunch' }), () => 'Brzuszki'),
    ).toBe('Ćwiczenia Brzuszki nie ma w katalogu.');
    expect(checkText(finding('NOT_IN_CATALOG', 'fail'))).toBe('Tego ćwiczenia nie ma w katalogu.');
    expect(
      checkText(finding('DAY_MAX_EXCEEDED', 'fail', { muscle: 'neck', after: 2, dayMax: 1 })),
    ).toBe('Neck dziś: 2 serie przy limicie 1.');
  });

  it('uses the name given for an exercise and falls back to its id', () => {
    const c = finding('OVERLAP_TODAY', 'fail', { exerciseId: 'crunch', samePattern: true });
    expect(checkText(c, () => 'Brzuszki')).toContain('Brzuszki');
    expect(checkText(c)).toContain('crunch');
  });

  it('each PLAN_INVALID reason reads differently, and an unknown one stays general', () => {
    const sentences = [
      'unknown exposure',
      'no pending sets',
      'training date mismatch',
      'empty reduction',
      'cannot drop completed side or more than pending',
      'something else',
    ].map((reason) => checkText(finding('PLAN_INVALID', 'fail', { reason })));
    expect(new Set(sentences).size).toBe(6);
    expect(checkText(finding('TECHNICAL_LIMIT', 'fail', { what: 'reps', top: 120 }))).toMatch(
      /Powtórzenia/,
    );
  });
});

describe('Polish plural forms', () => {
  it.each([
    [1, 'seria'],
    [2, 'serie'],
    [4, 'serie'],
    [5, 'serii'],
    [11, 'serii'],
    [12, 'serii'],
    [14, 'serii'],
    [22, 'serie'],
    [25, 'serii'],
    [0, 'serii'],
  ])('%s → %s', (n, expected) => {
    expect(plural(n, 'seria', 'serie', 'serii')).toBe(expected);
  });
});

describe('P4b.6 T72: the card for the same assessment, with no network', () => {
  const add = (id: string, sets?: number) =>
    ({ kind: 'add_exercise', exercise: { id }, ...(sets === undefined ? {} : { sets }) }) as const;

  it('an addable exercise: the verdict first, then the findings, the advice and the prescription', () => {
    const { snap, session } = world();
    const lines = text(assessSessionChange(snap, session, add('crunch')));
    expect(lines[0]).toBe('Można.');
    expect(lines.some((l) => l.startsWith('Zalecam '))).toBe(true);
    expect(lines.some((l) => l.startsWith('Recepta: '))).toBe(true);
    expect(lines.join(' ')).not.toMatch(BAD);
    expect(lines).toMatchSnapshot();
  });

  it('a request over the day limit is advised against with the numbers of the check', () => {
    const { snap, session } = world([recipe('crunch', 2)]);
    session.records = perform(session);
    const a = assessSessionChange(snap, session, add('crunch', 2));
    const lines = text(a);
    expect(lines[0]).toBe('Odradzam.');
    expect(lines[1]).toBe('Core dziś: 4 serie przy limicie 3.');
    expect(lines).toContain(
      'To ćwiczenie było dziś już zrobione, więc nowe serie są dodatkowe i nie wejdą do progresji.',
    );
    expect(lines).toMatchSnapshot();
  });

  it('an unknown exercise is blocked in plain words, with no prescription of its own', () => {
    const { snap, session } = world();
    const a = assessSessionChange(snap, session, {
      kind: 'add_exercise',
      exercise: { query: 'wyciskanie zza głowy' },
    });
    const lines = text(a);
    expect(lines[0]).toBe('Tego nie zrobię.');
    expect(lines[1]).toBe(
      'Nie znam ćwiczenia „wyciskanie zza głowy”, więc nie ocenię jego bezpieczeństwa.',
    );
    expect(lines.some((l) => l.startsWith('Recepta'))).toBe(false);
    expect(lines.join(' ')).not.toMatch(BAD);
  });

  it('an ambiguous request lists the candidates and says nothing else', () => {
    const { snap, session } = world();
    const a = assessSessionChange(snap, session, {
      kind: 'add_exercise',
      exercise: { query: 'wyciskanie hantli nad głowę' },
    });
    expect(a.verdict).toBe('needs_clarification');
    const lines = text(a);
    expect(lines[0]).toBe('Nie wiem, o które ćwiczenie chodzi.');
    expect(lines[1]).toMatch(/^Do wyboru: .+[.]$/);
    expect(lines).toHaveLength(2);
    const none = { ...a, resolved: { kind: 'ambiguous', candidates: [] } } as ChangeAssessment;
    expect(text(none)).toEqual(['Nie wiem, o które ćwiczenie chodzi.']);
  });

  it('is deterministic and never changes the assessment it reads', () => {
    const { snap, session } = world([recipe('crunch', 2)]);
    session.records = perform(session);
    const a = assessSessionChange(snap, session, add('crunch', 2));
    const before = JSON.stringify(a);
    expect(text(a)).toEqual(text(JSON.parse(before)));
    expect(JSON.stringify(a)).toBe(before);
  });

  it('puts hard failures before advice failures, and those before the information', () => {
    const { snap, session } = world([recipe('crunch', 2)]);
    session.records = perform(session);
    const a = assessSessionChange(snap, session, add('crunch', 2));
    const mixed: ChangeAssessment = {
      ...a,
      checks: [
        finding('CALIBRATION_FIRST', 'pass'),
        finding('DAY_MAX_EXCEEDED', 'fail', { muscle: 'core', after: 4, dayMax: 3 }),
        finding('PAIN_TODAY', 'fail'),
      ],
    };
    const lines = text(mixed);
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(at('ból')).toBeLessThan(at('Core dziś'));
    expect(at('Core dziś')).toBeLessThan(at('pierwsze podejście'));
  });

  it('shows repeated set findings once while retaining different setup times', () => {
    const { snap, session } = world();
    const a = assessSessionChange(snap, session, add('crunch'));
    const lines = text({
      ...a,
      checks: [
        finding('CALIBRATION_FIRST', 'pass'),
        finding('CALIBRATION_FIRST', 'pass'),
        finding('RESOURCE_CONFLICT', 'warn', { setupSec: 30 }),
        finding('RESOURCE_CONFLICT', 'warn', { setupSec: 30 }),
        finding('RESOURCE_CONFLICT', 'warn', { setupSec: 45 }),
      ],
    });
    expect(lines[0]).toBe(text(a)[0]);
    expect(lines.filter((line) => line.startsWith('To pierwsze podejście'))).toHaveLength(1);
    expect(lines.filter((line) => line.includes('około 30 s'))).toHaveLength(1);
    expect(lines.filter((line) => line.includes('około 45 s'))).toHaveLength(1);
    expect(lines.findIndex((line) => line.includes('około 30 s'))).toBeLessThan(
      lines.findIndex((line) => line.startsWith('To pierwsze podejście')),
    );
    expect(lines.some((line) => line.startsWith('Recepta:'))).toBe(true);
  });

  it('says the recommendation in the room the engine found, and when there is none', () => {
    const { snap, session } = world();
    const a = assessSessionChange(snap, session, add('crunch'));
    const rec = (n: number, extra = {}) =>
      text({
        ...a,
        recommendation: {
          position: 'next',
          sets: {
            recommended: n,
            allowed: n === 0 ? null : [1, 3],
            advisable: [1, 10],
            reasons: ['POLICY_DEFAULT'],
            ...extra,
          },
        },
      });
    expect(rec(2)).toContain('Zalecam 2 serie jako następne (mieści się do 3).');
    expect(rec(3)).toContain('Zalecam 3 serie jako następne.');
    expect(rec(0, { reasons: ['DAY_ROOM', 'WEEK_ROOM', 'NO_ROOM'] })).toContain(
      'Silnik nie widzi dziś miejsca na to ćwiczenie (limit dnia, limit tygodnia).',
    );
    expect(rec(0, { reasons: ['NO_ROOM'] })).toContain(
      'Silnik nie widzi dziś miejsca na to ćwiczenie.',
    );
    expect(
      text({
        ...a,
        recommendation: {
          position: 'end',
          sets: { recommended: 1, allowed: [1, 1], advisable: [1, 10], reasons: [] },
        },
      }),
    ).toContain('Zalecam 1 serię na końcu sesji.');
  });

  it('describes loads, rep ranges, times and distances of a prescription', () => {
    const { snap, session } = world();
    const a = assessSessionChange(snap, session, add('crunch'));
    const mass = a.prescription!.perSet[0]!.resistance;
    const set = (
      value: object,
      target: PrescriptionSummary['perSet'][number]['target'],
    ): PrescriptionSummary['perSet'][number] => ({
      resistance: { ...mass, value: { ...mass.value, ...value } } as typeof mass,
      target,
      targetRir: { min: 1, max: 3 },
    });
    const said = (perSet: PrescriptionSummary['perSet']) =>
      text({ ...a, prescription: { ...a.prescription!, sets: perSet.length, perSet } }).find((l) =>
        l.startsWith('Recepta'),
      );
    const reps = { kind: 'reps', min: 8, target: 10, max: 15, count: 'total' } as const;
    expect(said([set({ massGrams: 6500 }, reps)])).toBe(
      'Recepta: 1 seria, 6,5 kg, 8–15 powtórzeń.',
    );
    expect(
      said([set({ massGrams: 0 }, { ...reps, min: 5, target: 5, max: 5, count: 'per_side' })]),
    ).toBe('Recepta: 1 seria, 5 powtórzeń na stronę.');
    expect(said([set({ massGrams: 0 }, { ...reps, min: 1, target: 1, max: 1 })])).toBe(
      'Recepta: 1 seria, 1 powtórzenie.',
    );
    expect(said([set({}, { kind: 'duration', minSec: 30, targetSec: 40, maxSec: 45 })])).toMatch(
      /30–45 s\.$/,
    );
    expect(said([set({}, { kind: 'duration', minSec: 30, targetSec: 30, maxSec: 30 })])).toMatch(
      /30 s\.$/,
    );
    expect(said([set({}, { kind: 'distance', targetMeters: 100 })])).toMatch(/100 m\.$/);
    expect(said([set({ massGrams: 6000 }, reps), set({ massGrams: 7000 }, reps)])).toBe(
      'Recepta: 2 serie, 6 kg, 8–15 powtórzeń; 7 kg, 8–15 powtórzeń.',
    );
    expect(said([set({ massGrams: 6000 }, reps), set({ massGrams: 6000 }, reps)])).toBe(
      'Recepta: 2 serie, 6 kg, 8–15 powtórzeń.',
    );
  });

  it('names at most two alternatives, marks the discouraged ones and uses the given names', () => {
    const { snap, session } = world();
    const a = assessSessionChange(snap, session, add('crunch'));
    const alt = (exerciseId: string, verdict: Verdict, n: number) =>
      ({
        exerciseId,
        verdict,
        prescription: { ...a.prescription!, sets: n },
      }) as ChangeAssessment['alternatives'][number];
    const withAlts = {
      ...a,
      alternatives: [
        alt('crunch', 'ok', 1),
        alt('crunch', 'not_recommended', 2),
        alt('crunch', 'ok', 3),
      ],
    };
    const brzuszki = (id: string) => (id === 'crunch' ? 'Brzuszki' : undefined);
    const lines = assessmentText(withAlts, { exerciseName: brzuszki });
    expect(lines.at(-1)).toBe('Zamiast tego: Brzuszki (1 seria); Brzuszki (2 serie, odradzane).');
    expect(assessmentText(withAlts, { exerciseName: brzuszki, maxAlternatives: 3 }).at(-1)).toMatch(
      /\(3 serie\)\.$/,
    );
    expect(assessmentText(withAlts, { maxAlternatives: 1 }).at(-1)).toBe(
      'Zamiast tego: crunch (1 seria).',
    );
    expect(
      assessmentText({ ...withAlts, alternatives: [] }).some((l) => l.startsWith('Zamiast')),
    ).toBe(false);
  });
});

describe('P4b.6 T72: feel options in words', () => {
  const feel = (value: FeelChange['feel']) => {
    const rx = recipe('db-floor-press', 3);
    rx.sets = rx.sets.map((s) => ({
      ...s,
      resistance: { ...s.resistance, value: { ...s.resistance.value, massGrams: 8000 } },
    }));
    const { snap, session } = world([rx]);
    session.records = perform(session, 1);
    return assessSessionChange(snap, session, {
      kind: 'feel',
      exposureId: session.plan.exposures[0]!.id,
      feel: value,
    });
  };

  it('too hard: the recommended reduction first, the others after, and no failure for the reduction', () => {
    const lines = text(feel('too_hard'));
    expect(lines).toEqual([
      'Przyjęto: za ciężko.',
      'Polecam: lżejsze obciążenie na pozostałe serie.',
      'Inne możliwości: o jedną serię mniej; pominięcie reszty ćwiczenia.',
      'Skrócenie na twoją prośbę nie liczy się jako porażka siłowa.',
    ]);
  });

  it('too easy: one more set when it is fine, otherwise a note for the next prescription', () => {
    const a = feel('too_easy');
    const lines = text(a);
    expect(lines[0]).toBe('Przyjęto: za lekko.');
    expect(lines.join(' ')).not.toMatch(BAD);
    expect(lines).toMatchSnapshot();
    const marked = {
      ...a,
      feel: {
        ...a.feel!,
        options: a.feel!.options.map((o) => ({
          ...o,
          assessment: {
            ...o.assessment,
            verdict: (o.why === 'add_set' ? 'not_recommended' : 'blocked') as Verdict,
          },
        })),
      },
    };
    expect(text(marked).join(' ')).toMatch(/jedna seria więcej \(odradzane\)/);
    expect(text(marked).join(' ')).toMatch(/\(niedostępne\)/);
  });

  it('a session-wide report with nothing recommended lists only the other possibilities', () => {
    const a = feel('too_hard');
    const none = { ...a, feel: { ...a.feel!, recommendedOptionIds: [] } };
    expect(text(none)[1]).toMatch(/^Inne możliwości: /);
    expect(text(none).some((l) => l.startsWith('Polecam'))).toBe(false);
    expect(text(none).some((l) => l.startsWith('Skrócenie'))).toBe(false);
    const empty = { ...a, feel: { options: [], recommendedOptionIds: [] } };
    expect(text(empty)).toEqual(['Przyjęto: za ciężko.']);
  });

  it('an easier variant is offered in words as well', () => {
    const a = feel('too_hard');
    const variant = {
      ...a,
      feel: {
        ...a.feel!,
        options: a.feel!.options.map((o, i) =>
          i === 0 ? { ...o, why: 'variant_easier' as const } : o,
        ),
      },
    };
    expect(text(variant).join(' ')).toContain('łatwiejszy wariant ćwiczenia');
  });
});

describe('the two-sentence rule of the voice', () => {
  it('the first two sentences are the verdict and the most important finding', () => {
    const { snap, session } = world([recipe('crunch', 2)]);
    session.records = perform(session);
    const a = assessSessionChange(snap, session, {
      kind: 'add_exercise',
      exercise: { id: 'crunch' },
      sets: 2,
    });
    const [first, second] = text(a);
    expect(first).toBe('Odradzam.');
    expect(second).toBe(
      checkText(
        a.checks.find((c: AssessmentCheck) => c.code === 'DAY_MAX_EXCEEDED')!,
        (id) => id,
      ),
    );
  });
});
