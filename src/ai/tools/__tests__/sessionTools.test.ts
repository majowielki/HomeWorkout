import { assessSessionChange } from '../../../domain/session/assess';
import type {
  ActiveSessionState,
  ChangeAssessment,
  SessionChangeSnapshot,
} from '../../../domain/session/types';
import { CATALOG } from '../../../domain/__tests__/dayFixtures';
import { perform, recipe, world } from '../../../domain/__tests__/sessionChangeFixtures';
import type { ToolCall } from '../../contract/chat';
import { CHAT_TOOLS, toolResultSchemaFor } from '../../contract/chatTools';
import {
  activeSessionSummarySchema,
  assessmentSummarySchema,
  SESSION_LIMITS,
  sessionChangeInputSchema,
} from '../../contract/sessionTools';
import { executeTool } from '../execute';
import type { ToolEnvironment } from '../implementations';
import { changeOf, createSessionToolHooks, type SessionSource } from '../sessionEnvironment';
import { activeSessionSummary, assessmentSummary, musclesTodaySummary } from '../sessionSummary';

const BAD_ENV = {} as ToolEnvironment;

function started(specs = [recipe('db-floor-press', 3), recipe('crunch', 2)]) {
  const { snap, session } = world(specs);
  const state = { snap, session } as { snap: SessionChangeSnapshot; session: ActiveSessionState };
  const hooks = createSessionToolHooks(() => state as SessionSource);
  return { state, hooks };
}
const first = (s: ActiveSessionState) => s.plan.exposures[0]!;
const idOf = (s: ActiveSessionState, exerciseId: string) =>
  s.plan.exposures.find((e) => e.exercise.id === exerciseId)!.id;

describe('contract 7: the tools that consult the running session', () => {
  it('say there is no session when nothing runs, and refuse to guess', async () => {
    const hooks = createSessionToolHooks(() => null);
    expect(await hooks.activeSession()).toEqual({ error: 'no_active_session' });
    expect(await hooks.assessChange({ kind: 'add_sets', exposureId: 'x', sets: 1 })).toEqual({
      error: 'no_active_session',
    });
    expect(
      await hooks.proposeChange({ assessmentId: 'a'.repeat(64), patchId: 'b'.repeat(64) }),
    ).toEqual({ error: 'no_active_session' });
    // Without a phone side at all the tools answer in the same way, or failed for the one that writes.
    expect(await executeTool(call('getActiveSession', {}), BAD_ENV)).toMatchObject({
      output: { error: 'no_active_session' },
    });
    expect(
      await executeTool(
        call('assessSessionChange', { kind: 'skip_remaining', exposureId: 'x' }),
        BAD_ENV,
      ),
    ).toMatchObject({ output: { error: 'no_active_session' } });
    expect(
      await executeTool(
        call('proposeSessionChange', { assessmentId: 'a'.repeat(64), patchId: 'b'.repeat(64) }),
        BAD_ENV,
      ),
    ).toMatchObject({ output: { error: 'failed' } });
  });

  it('describes the workout: sets done, pending and skipped, the muscles, the day and the time', async () => {
    const { state, hooks } = started();
    state.session.records = perform(state.session, 1);
    const summary = await hooks.activeSession();
    expect(activeSessionSummarySchema.parse(summary)).toEqual(summary);
    const s = summary as ReturnType<typeof activeSessionSummary>;
    expect(s.sessionId).toBe('s1');
    expect(s.exposures[0]).toMatchObject({
      exposureId: first(state.session).id,
      exercise: { id: 'db-floor-press', name: CATALOG['db-floor-press']!.name },
      sets: { done: 1, pending: 2, skipped: 0 },
    });
    expect(s.exposures[1]!.sets).toEqual({ done: 0, pending: 2, skipped: 0 });
    expect(s.musclesToday.find((m) => m.muscle === 'chest')).toMatchObject({
      done: 1,
      remainingPlanned: 2,
      dayMax: 3,
    });
    expect(s.timeRemainingSec).toBeGreaterThan(0);
  });

  it('counts a planned set with no record as pending, and a skipped one as skipped', () => {
    const { state } = started([recipe('crunch', 2)]);
    const record = state.session.records[0]!;
    state.session.records = [
      { ...record, sets: [{ ...record.sets[0]!, disposition: 'skipped' as const }] },
    ];
    const summary = activeSessionSummary(state.session, state.snap);
    expect(summary.exposures[0]!.sets).toEqual({ done: 0, pending: 1, skipped: 1 });
    // An exercise with no record at all is all pending; one that the catalogue lost keeps its id as a name.
    state.session.records = [];
    expect(activeSessionSummary(state.session, state.snap).exposures[0]!.sets.pending).toBe(2);
    const lost = { ...state.snap, catalog: {} } as SessionChangeSnapshot;
    const bare = activeSessionSummary(state.session, lost).exposures[0]!;
    expect(bare.exercise).toEqual({ id: 'crunch', name: 'crunch' });
    expect(bare.muscles).toEqual([]);
  });

  it('lists a muscle that has only work done, one that has only work to do, and none that has neither', () => {
    expect(musclesTodaySummary({ chest: 2.4 }, { core: 1.6, back: 0 })).toEqual([
      { muscle: 'chest', done: 2, remainingPlanned: 0, dayMax: 3 },
      { muscle: 'core', done: 0, remainingPlanned: 2, dayMax: 3 },
    ]);
    expect(musclesTodaySummary({}, {})).toEqual([]);
  });

  it('proposes nothing for a feel that only leaves a note for the next prescription', async () => {
    const { state, hooks } = started([recipe('db-floor-press', 3)]);
    state.session.records = perform(state.session);
    const out = (await hooks.assessChange({
      kind: 'feel',
      exposureId: first(state.session).id,
      feel: 'too_easy',
    })) as ReturnType<typeof assessmentSummary>;
    expect(out.feelOptions!.find((o) => o.why === 'next_prescription')!.assessmentId).toBeNull();
  });

  it('cuts a long workout to what the contract holds', () => {
    const many = ['crunch', 'dead-bug', 'db-floor-press'].flatMap((id) =>
      Array.from({ length: 5 }, () => recipe(id, 1)),
    );
    const { state } = started(many.slice(0, 14));
    const summary = activeSessionSummary(state.session, state.snap);
    expect(summary.exposures.length).toBeLessThanOrEqual(SESSION_LIMITS.exposuresShown);
    expect(summary.musclesToday.length).toBeLessThanOrEqual(SESSION_LIMITS.musclesShown);
  });

  describe('assessSessionChange', () => {
    it('turns the words of the model into the references the engine resolves', () => {
      expect(changeOf({ kind: 'add_exercise', query: 'brzuszki' })).toEqual({
        kind: 'add_exercise',
        exercise: { query: 'brzuszki' },
      });
      expect(
        changeOf({ kind: 'add_exercise', query: 'brzuszki', sets: 2, placement: 'end' }),
      ).toEqual({
        kind: 'add_exercise',
        exercise: { query: 'brzuszki' },
        sets: 2,
        position: 'end',
      });
      expect(changeOf({ kind: 'swap_remaining', exposureId: 'e', query: 'deska' })).toEqual({
        kind: 'swap_remaining',
        exposureId: 'e',
        exercise: { query: 'deska' },
      });
      expect(changeOf({ kind: 'reduce_remaining', exposureId: 'e' })).toEqual({
        kind: 'reduce_remaining',
        exposureId: 'e',
      });
      expect(
        changeOf({ kind: 'reduce_remaining', exposureId: 'e', dropSets: 1, easier: true }),
      ).toEqual({
        kind: 'reduce_remaining',
        exposureId: 'e',
        dropSets: 1,
        easier: true,
      });
      expect(changeOf({ kind: 'add_sets', exposureId: 'e', sets: 1 })).toEqual({
        kind: 'add_sets',
        exposureId: 'e',
        sets: 1,
      });
      expect(changeOf({ kind: 'skip_remaining', exposureId: 'e' })).toEqual({
        kind: 'skip_remaining',
        exposureId: 'e',
      });
      expect(changeOf({ kind: 'feel', exposureId: null, feel: 'too_easy' })).toEqual({
        kind: 'feel',
        exposureId: null,
        feel: 'too_easy',
      });
    });

    it('answers an exercise the engine knows with the figures behind the verdict', async () => {
      const { state, hooks } = started();
      state.session.records = perform(state.session);
      const out = (await hooks.assessChange({
        kind: 'add_sets',
        exposureId: idOf(state.session, 'crunch'),
        sets: 2,
      })) as ReturnType<typeof assessmentSummary>;
      expect(assessmentSummarySchema.parse(out)).toEqual(out);
      expect(out.verdict).toBe('not_recommended');
      expect(out.checks[0]).toMatchObject({
        code: 'DAY_MAX_EXCEEDED',
        class: 'advice',
        status: 'fail',
      });
      expect(out.checks[0]!.data).toMatchObject({ muscle: 'core', dayMax: 3 });
      expect(out.patchId).toMatch(/^[0-9a-f]{64}$/);
      expect(out.time.maxSec).toBeGreaterThanOrEqual(0);
    });

    it('names a new exercise by the catalogue name, with a prescription of figures and no words of the person', async () => {
      const { hooks } = started([recipe('crunch', 2)]);
      const out = (await hooks.assessChange({
        kind: 'add_exercise',
        query: 'qwertyuiop',
        sets: 2,
      })) as ReturnType<typeof assessmentSummary>;
      // An id is not a name: the person's words that the catalogue does not know come back as "not found".
      expect(out.resolved.kind).toBe('not_found');
      expect(JSON.stringify(out)).not.toContain('"query"');
      const known = (await hooks.assessChange({
        kind: 'add_exercise',
        query: CATALOG['db-floor-press']!.name,
        sets: 2,
      })) as ReturnType<typeof assessmentSummary>;
      expect(known.resolved).toEqual({
        kind: 'exercise',
        exercise: { id: 'db-floor-press', name: CATALOG['db-floor-press']!.name },
      });
      expect(known.prescription!.exercise.name).toBe(CATALOG['db-floor-press']!.name);
      expect(known.prescription!.work.reduce((n, w) => n + w.sets, 0)).toBe(
        known.prescription!.sets,
      );
      expect(known.prescription!.work[0]!.target).toMatchObject({ kind: 'reps' });
      expect(known.recommendation).not.toBeNull();
    });

    it('lists the candidates of an ambiguous request and the nearest names of an unknown one', async () => {
      const { hooks } = started();
      const ambiguous = (await hooks.assessChange({
        kind: 'add_exercise',
        query: 'wyciskanie hantli nad głowę',
      })) as ReturnType<typeof assessmentSummary>;
      expect(ambiguous.verdict).toBe('needs_clarification');
      expect(ambiguous.resolved.kind).toBe('ambiguous');
      expect(ambiguous.patchId).toBeNull();
      expect((hooks as unknown as { proposals: Map<string, unknown> }).proposals.size).toBe(0);
      const unknown = (await hooks.assessChange({
        kind: 'add_exercise',
        query: 'qwertyuiop',
      })) as ReturnType<typeof assessmentSummary>;
      expect(unknown.verdict).toBe('blocked');
      expect(unknown.resolved).toMatchObject({ kind: 'not_found' });
      expect(unknown.checks.map((c) => c.code)).toContain('NOT_IN_CATALOG');
      expect(JSON.stringify(unknown)).not.toContain('qwertyuiop');
    });

    it('allows two assessments in a turn and then asks to wait for the next', async () => {
      const { state, hooks } = started();
      const ask = () =>
        hooks.assessChange({ kind: 'skip_remaining', exposureId: first(state.session).id });
      expect(await ask()).toMatchObject({ verdict: expect.any(String) });
      expect(await ask()).toMatchObject({ verdict: expect.any(String) });
      expect(await ask()).toEqual({ error: 'invalid_input' });
      hooks.newTurn();
      expect(await ask()).toMatchObject({ verdict: expect.any(String) });
    });

    it('reports what the engine offers for a feel, with the recommended option marked', async () => {
      const { state, hooks } = started([recipe('db-floor-press', 3)]);
      state.session.records = perform(state.session, 1);
      const out = (await hooks.assessChange({
        kind: 'feel',
        exposureId: first(state.session).id,
        feel: 'too_hard',
      })) as ReturnType<typeof assessmentSummary>;
      expect(assessmentSummarySchema.parse(out)).toEqual(out);
      expect(out.patchId).toBeNull();
      expect(out.feelOptions!.map((o) => o.why)).toEqual([
        'drop_set',
        'easier_resistance',
        'skip_remaining',
      ]);
      expect(out.feelOptions!.filter((o) => o.recommended)).toHaveLength(1);
      expect(out.feelOptions!.every((o) => o.assessmentId !== null && o.patchId !== null)).toBe(
        true,
      );
    });

    it('rejects a field nobody listed and a request with no exercise', () => {
      expect(
        sessionChangeInputSchema.safeParse({ kind: 'add_sets', exposureId: 'e', sets: 1, kg: 5 })
          .success,
      ).toBe(false);
      expect(sessionChangeInputSchema.safeParse({ kind: 'add_exercise' }).success).toBe(false);
      expect(
        sessionChangeInputSchema.safeParse({ kind: 'add_sets', exposureId: 'e', sets: 99 }).success,
      ).toBe(false);
    });
  });

  describe('proposeSessionChange', () => {
    const propose = (
      hooks: ReturnType<typeof createSessionToolHooks>,
      a: Awaited<ReturnType<typeof hooks.assessChange>>,
    ) => {
      const s = a as ReturnType<typeof assessmentSummary>;
      return hooks.proposeChange({ assessmentId: s.assessmentId, patchId: s.patchId! });
    };

    it('makes a card for an assessment, with the advice the person has to accept', async () => {
      const { state, hooks } = started();
      state.session.records = perform(state.session);
      const a = await hooks.assessChange({
        kind: 'add_sets',
        exposureId: idOf(state.session, 'crunch'),
        sets: 2,
      });
      const p = await propose(hooks, a);
      expect(p).toMatchObject({
        kind: 'session_change',
        requiresAcceptance: true,
        verdict: 'not_recommended',
        acknowledge: ['DAY_MAX_EXCEEDED'],
      });
      expect(CHAT_TOOLS.proposeSessionChange.output.safeParse(p).success).toBe(true);
      const proposal = hooks.proposals.get((p as { proposalId: string }).proposalId)!;
      expect(proposal.expected).toEqual({
        planRevision: 1,
        historyRevision: state.snap.historyRevision,
      });
      expect(proposal.change).toEqual({
        kind: 'add_sets',
        exposureId: idOf(state.session, 'crunch'),
        sets: 2,
      });
    });

    it('a change that is simply fine needs no acknowledgement', async () => {
      const { state, hooks } = started();
      const a = await hooks.assessChange({
        kind: 'skip_remaining',
        exposureId: first(state.session).id,
      });
      expect(await propose(hooks, a)).toMatchObject({ acknowledge: [] });
    });

    it('can propose one of the alternatives, which was assessed on its own', async () => {
      const { state, hooks } = started();
      const unknown = (await hooks.assessChange({
        kind: 'add_exercise',
        query: 'wyciskanie zza głowy',
      })) as ReturnType<typeof assessmentSummary>;
      const alt = unknown.alternatives[0]!;
      const p = await hooks.proposeChange({ assessmentId: alt.assessmentId, patchId: alt.patchId });
      expect(p).toMatchObject({ kind: 'session_change', patchId: alt.patchId });
      void state;
    });

    it('can propose an option of a feel report', async () => {
      const { state, hooks } = started([recipe('db-floor-press', 3)]);
      state.session.records = perform(state.session, 1);
      const out = (await hooks.assessChange({
        kind: 'feel',
        exposureId: first(state.session).id,
        feel: 'too_hard',
      })) as ReturnType<typeof assessmentSummary>;
      const option = out.feelOptions!.find((o) => o.recommended)!;
      const p = await hooks.proposeChange({
        assessmentId: option.assessmentId!,
        patchId: option.patchId!,
      });
      expect(p).toMatchObject({ kind: 'session_change' });
    });

    it('does not propose what was not assessed, what has no patch, or the patch of another assessment', async () => {
      const { state, hooks } = started();
      expect(
        await hooks.proposeChange({ assessmentId: 'f'.repeat(64), patchId: 'e'.repeat(64) }),
      ).toEqual({
        error: 'stale_assessment',
      });
      const blocked = (await hooks.assessChange({
        kind: 'add_exercise',
        query: 'qwertyuiop',
      })) as ReturnType<typeof assessmentSummary>;
      expect(
        await hooks.proposeChange({ assessmentId: blocked.assessmentId, patchId: 'e'.repeat(64) }),
      ).toEqual({
        error: 'invalid_input',
      });
      hooks.newTurn();
      const fine = (await hooks.assessChange({
        kind: 'skip_remaining',
        exposureId: first(state.session).id,
      })) as ReturnType<typeof assessmentSummary>;
      expect(
        await hooks.proposeChange({ assessmentId: fine.assessmentId, patchId: 'e'.repeat(64) }),
      ).toEqual({
        error: 'invalid_input',
      });
    });

    it('is stale when the workout moved on after the assessment', async () => {
      const { state, hooks } = started();
      const a = await hooks.assessChange({
        kind: 'add_sets',
        exposureId: first(state.session).id,
        sets: 1,
      });
      state.session.records = perform(state.session, 1);
      expect(await propose(hooks, a)).toEqual({ error: 'stale_assessment' });
    });
  });

  it('goes through the funnel of the executor: its output is checked against the contract', async () => {
    const { state, hooks } = started();
    const env: ToolEnvironment = {
      ...BAD_ENV,
      activeSession: hooks.activeSession,
      assessChange: hooks.assessChange,
      proposeSessionChange: hooks.proposeChange,
    };
    const active = await executeTool(call('getActiveSession', {}), env);
    expect(toolResultSchemaFor('getActiveSession').safeParse(active.output).success).toBe(true);
    const assessed = await executeTool(
      call('assessSessionChange', { kind: 'skip_remaining', exposureId: first(state.session).id }),
      env,
    );
    expect(assessed.output).toMatchObject({ verdict: 'ok' });
    const out = assessed.output as ReturnType<typeof assessmentSummary>;
    const proposed = await executeTool(
      call('proposeSessionChange', { assessmentId: out.assessmentId, patchId: out.patchId }),
      env,
    );
    expect(proposed.output).toMatchObject({ kind: 'session_change' });
  });
});

describe('what of an assessment reaches a model', () => {
  const base = (): ChangeAssessment => {
    const { snap, session } = world([recipe('crunch', 2)]);
    return assessSessionChange(snap, session, {
      kind: 'add_exercise',
      exercise: { id: 'crunch' },
      sets: 1,
    });
  };
  const catalog = CATALOG;

  it('withholds what the person typed and cuts long values and long lists of figures', () => {
    const a = base();
    const long = 'x'.repeat(200);
    const summary = assessmentSummary(
      {
        ...a,
        checks: [
          ...Array.from({ length: 7 }, () => ({
            code: 'NOT_IN_CATALOG' as const,
            class: 'hard' as const,
            status: 'fail' as const,
            data: {
              query: 'wyciskanie',
              message: 'zod says',
              path: 'a.b',
              long,
              ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i])),
            },
          })),
        ],
      },
      catalog,
    );
    expect(summary.checks).toHaveLength(SESSION_LIMITS.checksShown);
    const data = summary.checks[0]!.data;
    expect(Object.keys(data).length).toBeLessThanOrEqual(SESSION_LIMITS.dataKeys);
    expect(data).not.toHaveProperty('query');
    expect(data).not.toHaveProperty('message');
    expect(data).not.toHaveProperty('path');
    expect(data.long).toHaveLength(SESSION_LIMITS.dataChars);
    expect(assessmentSummarySchema.safeParse(summary).success).toBe(true);
  });

  it('gives kilograms for a mass and none for a band, and groups equal sets', () => {
    const a = base();
    const p = a.prescription!;
    const mass = p.perSet[0]!;
    const reps = (min: number, max: number, count: 'total' | 'per_side' = 'total') =>
      ({ kind: 'reps', min, target: max, max, count }) as const;
    const withMass = (grams: number) =>
      ({
        ...mass,
        resistance: { ...mass.resistance, value: { ...mass.resistance.value, massGrams: grams } },
      }) as typeof mass;
    const summary = assessmentSummary(
      {
        ...a,
        prescription: {
          ...p,
          sets: 5,
          perSet: [
            { ...withMass(6500), target: reps(8, 12) },
            { ...withMass(6500), target: reps(8, 12) },
            { ...withMass(0), target: reps(5, 5, 'per_side') },
            {
              ...mass,
              resistance: { ...mass.resistance, value: { kind: 'band' } as never },
              target: { kind: 'duration', minSec: 20, targetSec: 30, maxSec: 40 },
            },
            {
              ...mass,
              resistance: { ...mass.resistance, value: { kind: 'band' } as never },
              target: { kind: 'distance', targetMeters: 100 },
            },
          ],
        },
      },
      catalog,
    );
    expect(summary.prescription!.work).toEqual([
      { sets: 2, massKg: 6.5, target: { kind: 'reps', min: 8, max: 12, perSide: false } },
      { sets: 1, massKg: null, target: { kind: 'reps', min: 5, max: 5, perSide: true } },
      { sets: 1, massKg: null, target: { kind: 'duration', minSec: 20, maxSec: 40 } },
      { sets: 1, massKg: null, target: { kind: 'distance', meters: 100 } },
    ]);
    expect(assessmentSummarySchema.safeParse(summary).success).toBe(true);
  });

  it('has no recommendation, prescription or alternatives where the engine gave none', () => {
    const a = base();
    const bare = assessmentSummary(
      { ...a, recommendation: null, prescription: null, alternatives: [], patch: null },
      catalog,
    );
    expect(bare).toMatchObject({
      recommendation: null,
      prescription: null,
      alternatives: [],
      patchId: null,
      feelOptions: null,
    });
  });

  it('keeps an id as the name of an exercise the catalogue lost', () => {
    const a = base();
    const summary = assessmentSummary(a, {});
    expect(summary.prescription!.exercise).toEqual({ id: 'crunch', name: 'crunch' });
    expect(summary.resolved).toMatchObject({
      kind: 'exercise',
      exercise: { id: 'crunch', name: 'crunch' },
    });
  });

  it('shows an option whose change is only a note for the next prescription without an assessment id', () => {
    const { snap, session } = world([recipe('db-floor-press', 3)]);
    session.records = perform(session, 3);
    const a = assessSessionChange(snap, session, {
      kind: 'feel',
      exposureId: session.plan.exposures[0]!.id,
      feel: 'too_easy',
    });
    const summary = assessmentSummary(a, catalog);
    const note = summary.feelOptions!.find((o) => o.why === 'next_prescription')!;
    expect(note.assessmentId).toBeNull();
    expect(note.patchId).toBeNull();
  });
});

function call(name: ToolCall['name'], input: ToolCall['input']): ToolCall {
  return { id: 'call-1', name, input };
}
