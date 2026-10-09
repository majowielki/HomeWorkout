import { buildCoachContext } from '../../context/buildCoachContext';
import type { CoachSource } from '../../context/source';
import { CHAT_TOOLS, TOOL_LIMITS, TOOL_NAMES, type ToolName } from '../../contract/chatTools';
import type { ToolCall } from '../../contract/chat';
import { scenario, SYNTHETIC_EXERCISES, type ScenarioSpec } from '../../testing/synthetic';
import { executeTool, type ExecuteEnvironment } from '../execute';
import { syntheticPlan } from '../../testing/plan';
import { TOOL_IMPLEMENTATIONS, type ToolEnvironment } from '../implementations';

const envFor = (source: CoachSource): ToolEnvironment => ({
  load: async () => source,
  explainPlan: async ({ daysAgo }) => syntheticPlan(source, daysAgo),
});

async function run<N extends ToolName>(
  name: N,
  input: Record<string, unknown>,
  source: CoachSource = scenario(),
): Promise<unknown> {
  const implementation = TOOL_IMPLEMENTATIONS[name] as (
    i: unknown,
    e: ToolEnvironment,
  ) => Promise<unknown>;
  return implementation(input, envFor(source));
}

describe('the implementations', () => {
  it('cover exactly the tools of the contract', () => {
    expect(Object.keys(TOOL_IMPLEMENTATIONS).sort()).toEqual([...TOOL_NAMES].sort());
  });
  it.each([
    'getWeekPlan',
    'proposePlanChange',
    'proposeExtraSession',
    'getDayOptions',
    'proposeDayPlan',
  ] as const)('delegates %s without writes and handles an unavailable adapter', async (name) => {
    const env = envFor(scenario());
    expect(await TOOL_IMPLEMENTATIONS[name]({} as never, env)).toEqual({ error: 'failed' });
    const callback = jest.fn().mockResolvedValue({ error: 'no_plan' });
    const key = {
      getWeekPlan: 'week',
      proposePlanChange: 'proposeChange',
      proposeExtraSession: 'proposeExtra',
      getDayOptions: 'dayOptions',
      proposeDayPlan: 'proposeDay',
    }[name];
    expect(await TOOL_IMPLEMENTATIONS[name]({} as never, { ...env, [key]: callback })).toEqual({
      error: 'no_plan',
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe('the tools of contract 7 without a phone side, and with one', () => {
  it('answer without a session when nothing is wired, and delegate to what is', async () => {
    const env = envFor(scenario());
    expect(await TOOL_IMPLEMENTATIONS.simulateProposal({} as never, env)).toEqual({
      error: 'failed',
    });
    expect(await TOOL_IMPLEMENTATIONS.getActiveSession({}, env)).toEqual({
      error: 'no_active_session',
    });
    expect(await TOOL_IMPLEMENTATIONS.assessSessionChange({} as never, env)).toEqual({
      error: 'no_active_session',
    });
    expect(await TOOL_IMPLEMENTATIONS.proposeSessionChange({} as never, env)).toEqual({
      error: 'failed',
    });
    const simulate = jest.fn().mockResolvedValue({ error: 'no_plan' });
    expect(await TOOL_IMPLEMENTATIONS.simulateProposal({} as never, { ...env, simulate })).toEqual({
      error: 'no_plan',
    });
    expect(simulate).toHaveBeenCalledTimes(1);
  });

  it('explains a plan through the injected week query', async () => {
    const env = envFor(scenario());
    const explainPlan = jest.fn().mockResolvedValue({ error: 'no_plan' });
    expect(
      await TOOL_IMPLEMENTATIONS.getPlanExplanation({ daysAgo: 0 }, { ...env, explainPlan }),
    ).toEqual({ error: 'no_plan' });
    expect(explainPlan).toHaveBeenCalledWith({ daysAgo: 0 });
  });
});

describe('getRecentSessions', () => {
  it('counts each reported reason per exercise, excluding warm-ups', async () => {
    const source = scenario({ sessions: 1 });
    const first = source.sets[0]!;
    const reasons = ['doms', 'short_rest', 'technique', 'pain'] as const;
    const sets = reasons.map((shortfall, i) => ({
      ...first,
      id: `reported-${i}`,
      setIndex: i,
      shortfall,
    }));
    const out = await TOOL_IMPLEMENTATIONS.getRecentSessions(
      { count: 1 },
      envFor({
        ...source,
        sets: [
          ...sets,
          { ...first, id: 'none' },
          { ...first, id: 'warmup', isWarmup: true, shortfall: 'pain' },
        ],
      }),
    );
    expect(out).toMatchObject({
      sessions: [
        { exercises: [{ sets: 5, shortfalls: reasons.map((reason) => ({ reason, sets: 1 })) }] },
      ],
    });
    expect(CHAT_TOOLS.getRecentSessions.output.safeParse(out).success).toBe(true);
  });

  it.each(['doms', 'short_rest', 'technique', 'pain'] as const)(
    'passes %s through the strict exercise-history contract',
    async (reason) => {
      const source = scenario({ sessions: 1 });
      const first = source.sets[0]!;
      const out = await TOOL_IMPLEMENTATIONS.getExerciseHistory(
        { exerciseId: first.exerciseId, weeks: 4 },
        envFor({
          ...source,
          sets: [
            { ...first, shortfall: reason },
            { ...first, id: 'missing', setIndex: 1 },
            { ...first, id: 'null', setIndex: 2, shortfall: null },
          ],
        }),
      );
      expect(out).toMatchObject({
        sessions: [{ sets: [{ shortfall: reason }, { shortfall: null }, { shortfall: null }] }],
      });
      expect(CHAT_TOOLS.getExerciseHistory.output.safeParse(out).success).toBe(true);
    },
  );
  it('lists the newest sessions first with what was done, and counts all of them', async () => {
    const source = scenario();
    const out = (await run('getRecentSessions', { count: 3 }, source)) as {
      totalCompleted: number;
      sessions: { date: string; durationMin: number; workingSets: number; exercises: unknown[] }[];
    };
    expect(out.totalCompleted).toBe(29); // 9 in the window, 20 older
    expect(out.sessions.map((s) => s.date)).toEqual(['2026-09-29', '2026-09-26', '2026-09-23']);
    const latestSets = source.sets.filter((set) => set.workoutId === 'w-8').length;
    expect(out.sessions[0]).toMatchObject({
      durationMin: 42,
      sessionRpe: 7,
      workingSets: latestSets,
    });
    expect(out.sessions[0]!.exercises).toHaveLength(6);
    expect(CHAT_TOOLS.getRecentSessions.output.safeParse(out).success).toBe(true);
  });

  it('does not count a warm-up as a working set', async () => {
    const source = scenario({ sessions: 1 });
    const warmed = {
      ...source,
      sets: source.sets.map((s, i) => (i < 2 ? { ...s, isWarmup: true } : s)),
    };
    const base = (await run('getRecentSessions', { count: 1 }, source)) as {
      sessions: { workingSets: number }[];
    };
    const out = (await run('getRecentSessions', { count: 1 }, warmed)) as typeof base;
    expect(out.sessions[0]!.workingSets).toBe(base.sessions[0]!.workingSets - 2);
  });

  it('leaves out a session older than its window, but still counts it', async () => {
    const base = scenario({ sessions: 1, olderSessions: 0 });
    const source = {
      ...base,
      completedWorkouts: [
        ...base.completedWorkouts,
        { ...base.completedWorkouts[0]!, id: 'ancient', trainingDate: '2026-05-01' },
      ],
    };
    const out = (await run('getRecentSessions', { count: 6 }, source)) as {
      totalCompleted: number;
      sessions: { date: string }[];
    };
    expect(out.totalCompleted).toBe(2);
    expect(out.sessions.map((x) => x.date)).toEqual(['2026-09-29']);
  });

  it('ignores a session dated after today', async () => {
    const source = scenario({ sessions: 2 });
    const future = {
      ...source,
      completedWorkouts: [
        ...source.completedWorkouts,
        { ...source.completedWorkouts[0]!, id: 'later', trainingDate: '2026-10-05' },
      ],
    };
    const out = (await run('getRecentSessions', { count: 6 }, future)) as {
      totalCompleted: number;
    };
    expect(out.totalCompleted).toBe(22);
  });

  it('breaks a tie between two sessions on one day by start time', async () => {
    const source = scenario({ sessions: 1 });
    const first = source.completedWorkouts.find((w) => w.id === 'w-0')!;
    const twice = {
      ...source,
      completedWorkouts: [
        ...source.completedWorkouts,
        {
          ...first,
          id: 'evening',
          startedAt: `${first.trainingDate}T20:00:00.000Z`,
          finishedAt: null,
        },
      ],
    };
    const out = (await run('getRecentSessions', { count: 2 }, twice)) as {
      sessions: { durationMin: number | null }[];
    };
    expect(out.sessions.map((s) => s.durationMin)).toEqual([null, 42]);
  });
});

describe('a set of an exercise the catalogue does not have', () => {
  it('is listed under its id rather than lost', async () => {
    const source = scenario({ sessions: 1 });
    const odd = {
      ...source,
      sets: source.sets.map((s, i) => (i === 0 ? { ...s, exerciseId: 'retired-move' } : s)),
    };
    const out = (await run('getRecentSessions', { count: 1 }, odd)) as {
      sessions: { exercises: { id: string; name: string }[] }[];
    };
    expect(out.sessions[0]!.exercises).toContainEqual(
      expect.objectContaining({ id: 'retired-move', name: 'retired-move' }),
    );
  });
});

describe('getExerciseHistory', () => {
  const history = (spec: ScenarioSpec, weeks = 4, exerciseId = 'goblet-squat') =>
    run('getExerciseHistory', { exerciseId, weeks }, scenario(spec)) as Promise<{
      exercise: { id: string; name: string };
      sessionCount: number;
      verdict: string;
      sessions: { date: string; sets: unknown[] }[];
    }>;

  it('reports the verdict the app computes, for each way the numbers can move', async () => {
    expect((await history({ progress: 'improving' })).verdict).toBe('improved');
    expect((await history({ progress: 'flat' })).verdict).toBe('maintained');
    expect((await history({ progress: 'declining', sessions: 12, cadenceDays: 2 })).verdict).toBe(
      'declined',
    );
  });

  it('agrees with the verdict in the weekly brief', async () => {
    const source = scenario({ progress: 'improving' });
    const brief = buildCoachContext(source).context.trends.find(
      (t) => t.exerciseId === 'goblet-squat',
    );
    const out = (await run(
      'getExerciseHistory',
      { exerciseId: 'goblet-squat', weeks: 4 },
      source,
    )) as {
      verdict: string;
      sessionCount: number;
    };
    expect(out.verdict).toBe(brief?.verdict);
    expect(out.sessionCount).toBe(brief?.sessions);
  });

  it('lists sets oldest first, with the load as it was logged', async () => {
    const out = await history({ progress: 'flat' });
    expect(out.exercise).toEqual({ id: 'goblet-squat', name: expect.any(String) });
    expect(out.sessions.map((s) => s.date)).toEqual([...out.sessions.map((s) => s.date)].sort());
    expect(out.sessions[0]!.sets[0]).toMatchObject({
      load: { kind: 'dumbbell', mode: 'single', kg: 10 },
    });
    expect(CHAT_TOOLS.getExerciseHistory.output.safeParse(out).success).toBe(true);
  });

  it('shows only the latest sessions but counts all of them', async () => {
    const out = await history({ sessions: 28, cadenceDays: 1, lastSessionDaysAgo: 0 });
    expect(out.sessionCount).toBe(14);
    expect(out.sessions).toHaveLength(TOOL_LIMITS.historySessionsShown);
  });

  it('says so when it has too little to judge', async () => {
    const out = await history({ sessions: 1 });
    expect(out).toMatchObject({ verdict: 'insufficient_data', sessionCount: 1 });
  });

  it('answers with an error the model can act on for an id it made up', async () => {
    expect(await run('getExerciseHistory', { exerciseId: 'tail-curl', weeks: 4 })).toEqual({
      error: 'unknown_exercise',
    });
  });

  it('puts two sessions on one day in the order they started', async () => {
    const source = scenario({ sessions: 2 });
    const first = source.completedWorkouts.find((w) => w.id === 'w-0')!;
    const sets = source.sets.filter(
      (s) => s.workoutId === 'w-0' && s.exerciseId === 'goblet-squat',
    );
    const same = {
      ...source,
      completedWorkouts: [
        ...source.completedWorkouts,
        { ...first, id: 'earlier', startedAt: `${first.trainingDate}T08:00:00.000Z` },
      ],
      sets: [
        ...source.sets,
        ...sets.map((s) => ({ ...s, id: `e-${s.id}`, workoutId: 'earlier', reps: 77 })),
      ],
    };
    const out = (await run(
      'getExerciseHistory',
      { exerciseId: 'goblet-squat', weeks: 4 },
      same,
    )) as {
      sessions: { date: string; sets: { reps: number }[] }[];
    };
    const onThatDay = out.sessions.filter((x) => x.date === first.trainingDate);
    expect(onThatDay.map((x) => x.sets[0]!.reps === 77)).toEqual([true, false]);
  });

  it('puts two sets logged for one index in the order they were logged', async () => {
    const source = scenario({ sessions: 2 });
    const goblet = source.sets.filter(
      (s) => s.exerciseId === 'goblet-squat' && s.workoutId === 'w-0',
    );
    const reordered = {
      ...source,
      sets: [
        ...source.sets,
        { ...goblet[0]!, id: 'dup', loggedAt: '2026-09-20T17:05:00.000Z', reps: 99 },
        { ...goblet[0]!, id: 'dup-earlier', loggedAt: '2026-09-20T16:00:00.000Z', reps: 98 },
      ],
    };
    const out = (await run(
      'getExerciseHistory',
      { exerciseId: 'goblet-squat', weeks: 4 },
      reordered,
    )) as {
      sessions: { sets: { reps: number }[] }[];
    };
    const reps = out.sessions[0]!.sets.map((s) => s.reps);
    expect(reps.indexOf(98)).toBeLessThan(reps.indexOf(99));
  });
});

describe('getWeeklyVolume', () => {
  it.each([0, 1, 2, 3])('matches week %i of the weekly brief', async (weeksAgo) => {
    const source = scenario();
    const brief = buildCoachContext(source).context.weeklyVolume[weeksAgo];
    expect(await run('getWeeklyVolume', { weeksAgo }, source)).toEqual(brief);
  });

  it('answers for a week with no training with no muscles', async () => {
    const out = (await run('getWeeklyVolume', { weeksAgo: 8 })) as { muscles: unknown[] };
    expect(out.muscles).toEqual([]);
  });

  it('skips the warm-ups and the sets of a session it does not know', async () => {
    const source = scenario({ sessions: 1 });
    const bare = (await run('getWeeklyVolume', { weeksAgo: 0 }, source)) as {
      muscles: { sets: number }[];
    };
    const noisy = {
      ...source,
      sets: [
        ...source.sets.map((s) => ({ ...s, isWarmup: true })),
        { ...source.sets[0]!, id: 'orphan', workoutId: 'nowhere' },
      ],
    };
    const out = (await run('getWeeklyVolume', { weeksAgo: 0 }, noisy)) as typeof bare;
    expect(bare.muscles.length).toBeGreaterThan(0);
    expect(out.muscles).toEqual([]);
  });
});

describe('getBodyTrend', () => {
  it('matches the weight and waist in the weekly brief', async () => {
    const source = scenario({
      weight: { startKg: 96, perWeekKg: -0.6 },
      waist: { startCm: 104, perWeekCm: -0.5 },
    });
    const { weight, waist } = buildCoachContext(source).context;
    expect(await run('getBodyTrend', { days: 28 }, source)).toEqual({ days: 28, weight, waist });
  });

  it('narrows to the days asked for', async () => {
    const source = scenario({ weight: { startKg: 96, perWeekKg: -0.6 } });
    const week = (await run('getBodyTrend', { days: 7 }, source)) as {
      weight: { entries: number };
    };
    const month = (await run('getBodyTrend', { days: 28 }, source)) as typeof week;
    expect(week.weight.entries).toBe(7);
    expect(month.weight.entries).toBe(28);
  });

  it('returns nulls, not zeros, when nothing was measured', async () => {
    const source = scenario({ weight: null, waist: null });
    expect(await run('getBodyTrend', { days: 30 }, source)).toEqual({
      days: 30,
      weight: null,
      waist: null,
    });
  });
});

describe('getPlanExplanation', () => {
  it('has no plan when the environment supplies no explanation', async () => {
    expect(
      await TOOL_IMPLEMENTATIONS.getPlanExplanation(
        { daysAgo: 0 },
        { load: async () => scenario() },
      ),
    ).toEqual({ error: 'no_plan' });
  });
  it('reads the current planner from synthetic logged work', async () => {
    const source = scenario({ highSoreness: ['quads'] });
    const out = await run('getPlanExplanation', { daysAgo: 0 }, source);
    expect(() => CHAT_TOOLS.getPlanExplanation.output.parse(out)).not.toThrow();
    expect(out).toMatchObject({ source: 'today', date: source.asOf });
    expect((out as { skipped: { movement: string; reason: string }[] }).skipped).toContainEqual(
      expect.objectContaining({ movement: 'Przysiad', reason: 'DOMS_HIGH' }),
    );
    expect(await run('getPlanExplanation', { daysAgo: 1 }, source)).toEqual({ error: 'no_plan' });
  });
});
describe('findExercises', () => {
  const find = (input: Record<string, unknown>) =>
    run('findExercises', input) as Promise<{
      total: number;
      exercises: { id: string; name: string; primaryMuscles: string[] }[];
    }>;

  it('finds by muscle group', async () => {
    const out = await find({ muscle: 'quads' });
    expect(out.exercises.length).toBeGreaterThan(0);
    expect(out.exercises.every((e) => e.primaryMuscles.includes('quads'))).toBe(true);
    expect(out.exercises.map((e) => e.id)).toContain('goblet-squat');
  });

  it('finds by part of a name, without caring for case or diacritics', async () => {
    const target = SYNTHETIC_EXERCISES.find((e) => /[ąćęłńóśźż]/i.test(e.name))!;
    const plain = target.name
      .toUpperCase()
      .replace('Ł', 'L')
      .replace('Ó', 'O')
      .replace('Ś', 'S')
      .replace('Ż', 'Z')
      .replace('Ć', 'C')
      .replace('Ę', 'E')
      .replace('Ą', 'A')
      .replace('Ń', 'N')
      .replace('Ź', 'Z');
    const out = await find({ query: plain });
    expect(out.exercises.map((e) => e.id)).toContain(target.id);
  });

  it('combines muscle and name', async () => {
    const all = await find({ muscle: 'quads' });
    const one = await find({ muscle: 'quads', query: all.exercises[0]!.name });
    expect(one.exercises.map((e) => e.id)).toContain(all.exercises[0]!.id);
    expect(one.total).toBeLessThanOrEqual(all.total);
  });

  it('lists at most ten and says how many there were', async () => {
    const out = await find({ query: 'a' });
    expect(out.total).toBeGreaterThan(TOOL_LIMITS.findResults);
    expect(out.exercises).toHaveLength(TOOL_LIMITS.findResults);
  });

  it('says there are none rather than failing', async () => {
    expect(await find({ query: 'zzzzzz' })).toEqual({ total: 0, exercises: [] });
  });

  it('asks for something to look for when given nothing', async () => {
    expect(await find({})).toEqual({ error: 'invalid_input' });
    expect(await find({ query: '   ' })).toEqual({ error: 'invalid_input' });
  });
});

describe('executeTool', () => {
  const call = (name: ToolName, input: Record<string, unknown>): ToolCall => ({
    id: 'call-1',
    name,
    input: input as ToolCall['input'],
  });
  const env = (source = scenario(), report?: ExecuteEnvironment['report']): ExecuteEnvironment => ({
    ...envFor(source),
    report,
  });

  it('answers with the result for the call that was made', async () => {
    const result = await executeTool(call('getWeeklyVolume', { weeksAgo: 0 }), env());
    expect(result).toMatchObject({ callId: 'call-1', name: 'getWeeklyVolume' });
    expect(result.output).toMatchObject({ endDate: '2026-10-01' });
  });

  it('answers a request that does not fit the tool with an error, running nothing', async () => {
    const load = jest.fn();
    const result = await executeTool(call('getWeeklyVolume', { weeksAgo: 99 }), {
      load,
    });
    expect(result.output).toEqual({ error: 'invalid_input' });
    expect(load).not.toHaveBeenCalled();
  });

  it('turns a tool that throws into a plain "failed" and reports the cause', async () => {
    const report = jest.fn();
    const broken: ExecuteEnvironment = {
      load: async () => {
        throw new Error('database is locked');
      },

      report,
    };
    const result = await executeTool(call('getBodyTrend', { days: 30 }), broken);
    expect(result.output).toEqual({ error: 'failed' });
    expect(report).toHaveBeenCalledWith(
      'getBodyTrend',
      expect.objectContaining({ message: 'database is locked' }),
    );
  });

  it('does not need anyone listening for failures', async () => {
    const broken: ExecuteEnvironment = {
      load: async () => {
        throw new Error('x');
      },
    };
    expect((await executeTool(call('getBodyTrend', { days: 30 }), broken)).output).toEqual({
      error: 'failed',
    });
  });

  it('never lets through an output its own schema refuses', async () => {
    const report = jest.fn();
    const source = { ...scenario(), exercises: [{ ...SYNTHETIC_EXERCISES[0]!, name: '' }] };
    const result = await executeTool(
      call('findExercises', { muscle: 'quads' }),
      env(source, report),
    );
    expect(result.output).toEqual({ error: 'failed' });
    expect(report).toHaveBeenCalledWith('findExercises', expect.anything());
  });
});
