import { defaultPreferences } from '../../../domain/preferences/preferences';
import type { SimulationBase } from '../../../domain/session/simulateProposal';
import { CATALOG, ELIGIBILITY, SELECTIONS, SLOTS } from '../../../domain/__tests__/dayV2Fixtures';
import { VERSIONS } from '../../../domain/__tests__/compileFixtures';
import { HASH_A } from '../../../domain/__tests__/planV2Fixtures';
import { perform, recipe, world } from '../../../domain/__tests__/sessionChangeFixtures';
import type { ToolInput } from '../../contract/chatTools';
import { simulateInputSchema, simulateOutputSchema } from '../../contract/simulationTools';
import { executeTool } from '../execute';
import { createSimulationHook } from '../simulationEnvironment';

const FROM = '2026-10-05';
const base = (patch: Partial<SimulationBase> = {}): SimulationBase => ({
  asOf: FROM,
  catalog: CATALOG,
  slots: SLOTS,
  eligibility: ELIGIBILITY,
  block: {
    index: 1,
    startedOn: FROM,
    deloadFrom: null,
    deloadReason: null,
    selections: SELECTIONS,
  },
  endedBlocks: [],
  records: [],
  rides: [],
  daily: [],
  preferences: defaultPreferences(),
  versions: VERSIONS,
  snapshotFingerprint: HASH_A,
  ...patch,
});
const ask = (
  proposal: ToolInput<'simulateProposal'>['proposal'],
): ToolInput<'simulateProposal'> => ({
  proposal,
  horizonDays: 7,
  athlete: 'follows_plan',
});

describe('simulateProposal, the phone side', () => {
  it('turns relative days into dates and answers with the plan with and without the request', async () => {
    const simulate = createSimulationHook(() => base());
    const out = await simulate(
      ask({
        kind: 'week_change',
        constraints: [{ kind: 'rest_day', muscles: [], fromDaysAhead: 2, days: 1, reason: 'busy' }],
      }),
    );
    expect(simulateOutputSchema.safeParse(out).success).toBe(true);
    const o = out as Exclude<typeof out, { error: string }>;
    expect(o.diff.daysChanged).toContain('2026-10-07');
    expect(o.baseline.minutesPerDay[2]).toBeGreaterThan(0);
    expect(o.withProposal.minutesPerDay[2]).toBe(0);
    expect(o.diff.minutesPerDay[2]).toBe(-o.baseline.minutesPerDay[2]!);
    expect(o.baseline.musclesWeek).toHaveLength(12);
    expect(o.verdict).toBeNull();
    expect(o.horizonDays).toBe(7);
  });

  it('a request that takes a muscle out for a number of days reaches that many days', async () => {
    const simulate = createSimulationHook(() => base());
    const out = (await simulate(
      ask({
        kind: 'week_change',
        constraints: [
          { kind: 'avoid_muscle', muscles: ['glutes'], fromDaysAhead: 0, days: 3, reason: 'doms' },
        ],
      }),
    )) as { diff: { musclesWeek: { muscle: string; sets: number }[] } };
    const glutes = out.diff.musclesWeek.find((m) => m.muscle === 'glutes');
    expect(glutes === undefined || glutes.sets <= 0).toBe(true);
  });

  it('a number of sets of its own for some kinds of exercise replaces the engine’s for those', async () => {
    const simulate = createSimulationHook(() => base());
    const out = (await simulate(
      ask({ kind: 'policy_change', setsPerExposure: { compound: 1, core: 1 } }),
    )) as Exclude<Awaited<ReturnType<typeof simulate>>, { error: string }>;
    const total = (s: typeof out.baseline) => s.musclesWeek.reduce((n, m) => n + m.sets, 0);
    expect(total(out.withProposal)).toBeLessThan(total(out.baseline));
  });

  it('a profile alone, or nothing at all, is a policy change; nothing at all changes nothing', async () => {
    const simulate = createSimulationHook(() => base());
    const same = (await simulate(ask({ kind: 'policy_change', setsPerExposure: {} }))) as Exclude<
      Awaited<ReturnType<typeof simulate>>,
      { error: string }
    >;
    expect(same.baseline).toEqual(same.withProposal);
    expect(same.diff.daysChanged).toEqual([]);
    const higher = (await simulate(
      ask({ kind: 'policy_change', volumeProfile: 'higher' }),
    )) as Exclude<Awaited<ReturnType<typeof simulate>>, { error: string }>;
    expect(simulateOutputSchema.safeParse(higher).success).toBe(true);
  });

  it('a change to the workout needs a workout; with one it carries the engine’s verdict', async () => {
    const none = createSimulationHook(() => base());
    expect(
      await none(
        ask({ kind: 'session_change', change: { kind: 'skip_remaining', exposureId: 'x' } }),
      ),
    ).toEqual({ error: 'no_active_session' });

    const { snap, session } = world([recipe('db-floor-press', 3), recipe('crunch', 2)]);
    session.records = perform(session, 1);
    const live = createSimulationHook(() =>
      base({
        asOf: snap.asOf,
        records: session.records,
        running: session.plan,
        session: { snap, state: session },
      }),
    );
    const out = (await live(
      ask({
        kind: 'session_change',
        change: { kind: 'skip_remaining', exposureId: session.plan.exposures[1]!.id },
      }),
    )) as Exclude<Awaited<ReturnType<typeof live>>, { error: string }>;
    expect(simulateOutputSchema.safeParse(out).success).toBe(true);
    expect(out.verdict).toMatch(/ok/);
    expect(out.baseline.minutesPerDay).toHaveLength(7);
  });

  it('goes through the funnel of the executor like any tool', async () => {
    const simulate = createSimulationHook(() => base());
    const result = await executeTool(
      {
        id: 'c1',
        name: 'simulateProposal',
        input: ask({
          kind: 'week_change',
          constraints: [
            { kind: 'lighter_day', muscles: [], fromDaysAhead: 1, days: 1, reason: 'other' },
          ],
        }),
      },
      { load: undefined as never, simulate },
    );
    expect(result.output).toMatchObject({ horizonDays: 7, athlete: 'follows_plan' });
    // Without a phone side the tool says it failed, like the others.
    const missing = await executeTool(
      { id: 'c2', name: 'simulateProposal', input: ask({ kind: 'policy_change' }) },
      { load: undefined as never },
    );
    expect(missing.output).toEqual({ error: 'failed' });
  });

  it('accepts the horizons the contract names and nothing else, and no field for a load', () => {
    const ok = ask({ kind: 'policy_change' });
    for (const horizonDays of [7, 14, 28])
      expect(simulateInputSchema.safeParse({ ...ok, horizonDays }).success).toBe(true);
    expect(simulateInputSchema.safeParse({ ...ok, horizonDays: 10 }).success).toBe(false);
    expect(simulateInputSchema.safeParse({ ...ok, athlete: 'hopeful' }).success).toBe(false);
    expect(
      simulateInputSchema.safeParse({
        ...ok,
        proposal: { kind: 'policy_change', setsPerExposure: { compound: 99 } },
      }).success,
    ).toBe(false);
  });
});
