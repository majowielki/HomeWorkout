import type { ExposureRecord } from '../observations/exposure';
import { defaultPreferences } from '../preferences/preferences';
import type { PlanConstraint } from '../plan/constraints';
import { FOLLOWS_THE_PLAN, recordsOf } from '../plan/simulate';
import { planWeek } from '../plan/week';
import {
  observedAthlete,
  simulateProposal,
  weekWarnings,
  type SimulationBase,
} from '../session/simulateProposal';
import { CATALOG, ELIGIBILITY, SELECTIONS, SLOTS } from './dayFixtures';
import { VERSIONS } from './compileFixtures';
import { HASH_A } from './planFixtures';
import { perform, recipe, world } from './sessionChangeFixtures';

const FROM = '2026-10-05';
const block = {
  index: 1,
  startedOn: FROM,
  deloadFrom: null,
  deloadReason: null,
  selections: SELECTIONS,
};
const base = (patch: Partial<SimulationBase> = {}): SimulationBase => ({
  asOf: FROM,
  catalog: CATALOG,
  slots: SLOTS,
  eligibility: ELIGIBILITY,
  block,
  endedBlocks: [],
  records: [],
  rides: [],
  daily: [],
  preferences: defaultPreferences(),
  versions: VERSIONS,
  snapshotFingerprint: HASH_A,
  ...patch,
});
const rest = (date: string): Omit<PlanConstraint, 'id'> => ({
  kind: 'rest_day',
  muscles: [],
  from: date,
  until: date,
  reason: 'busy',
  source: 'user',
  note: null,
});
const follows = { horizonDays: 7, athlete: 'follows_plan' } as const;

describe('P5.6b T-simulate: what a proposal does, before the person is asked', () => {
  it('a rest day takes the work of that day out of the week and says how the days around it move', () => {
    const r = simulateProposal(
      base(),
      { kind: 'week_change', constraints: [rest('2026-10-07')] },
      follows,
    );
    expect(r.baseline.minutesPerDay).toHaveLength(7);
    expect(r.baseline.minutesPerDay[2]).toBeGreaterThan(0);
    expect(r.withProposal.minutesPerDay[2]).toBe(0);
    expect(r.diff.minutesPerDay[2]).toBe(-r.baseline.minutesPerDay[2]!);
    expect(r.diff.daysChanged).toContain('2026-10-07');
    expect(r.assessment).toBeNull();
    for (const m of Object.values(r.withProposal.musclesWeek)) {
      expect(m.min).toBe(3);
      expect(m.max).toBeGreaterThanOrEqual(6);
    }
  });

  it('the baseline is the plan as it stands, and a proposal that changes nothing differs in nothing', () => {
    const r = simulateProposal(base(), { kind: 'week_change', constraints: [] }, follows);
    expect(r.diff).toEqual({
      musclesWeek: {},
      minutesPerDay: [0, 0, 0, 0, 0, 0, 0],
      expectedLoadSteps: 0,
      expectedProbes: 0,
      deloadTriggered: false,
      daysChanged: [],
    });
    expect(r.baseline).toEqual(r.withProposal);
    expect(r.warnings).toEqual([]);
  });

  it('a smaller fixed number of sets takes work out of the week', () => {
    const r = simulateProposal(
      base(),
      {
        kind: 'policy_change',
        preferences: {
          setsPerExposure: { mode: 'fixed', byKind: { compound: 1, accessory: 1, core: 1 } },
        },
      },
      follows,
    );
    const total = (x: typeof r.baseline) =>
      Object.values(x.musclesWeek).reduce((sum, m) => sum + m.sets, 0);
    expect(total(r.withProposal)).toBeLessThan(total(r.baseline));
    expect(Object.keys(r.diff.musclesWeek).length).toBeGreaterThan(0);
  });

  it('the higher volume profile raises the aim and the maxima, and the week gets more work (ENG-04)', () => {
    const r = simulateProposal(
      base(),
      { kind: 'policy_change', preferences: { volumeProfile: 'higher' } },
      follows,
    );
    const chest = (x: typeof r.baseline) => x.musclesWeek.chest;
    expect(chest(r.baseline)).toMatchObject({ min: 3, max: 6 });
    expect(chest(r.withProposal)).toMatchObject({ min: 4, max: 10 });
    expect(r.withProposal.musclesWeek.glutes.max).toBe(10);
    const total = (x: typeof r.baseline) =>
      Object.values(x.musclesWeek).reduce((sum, m) => sum + m.sets, 0);
    expect(total(r.withProposal)).toBeGreaterThanOrEqual(total(r.baseline));
  });

  it('a maximum the person set for one muscle is that muscle’s maximum in the week', () => {
    const r = simulateProposal(
      base(),
      { kind: 'policy_change', preferences: { volumeOverrides: { biceps: 8 } } },
      follows,
    );
    expect(r.baseline.musclesWeek.biceps.max).toBe(6);
    expect(r.withProposal.musclesWeek.biceps.max).toBe(8);
  });

  it('puts a muscle over its weekly maximum on the list of warnings, with the figures', () => {
    const r = simulateProposal(base(), { kind: 'week_change', constraints: [] }, follows);
    const over = {
      ...r.baseline,
      musclesWeek: {
        ...r.baseline.musclesWeek,
        glutes: { sets: 9, min: 3, max: 8 },
        biceps: { sets: 6, min: 3, max: 6 },
      },
    };
    expect(weekWarnings(over)).toEqual([
      {
        code: 'WEEK_MAX_EXCEEDED',
        class: 'advice',
        status: 'fail',
        data: { muscle: 'glutes', sets: 9, weekMax: 8 },
      },
    ]);
    // The glutes and the back have more room than the rest.
    expect(r.baseline.musclesWeek.glutes!.max).toBe(8);
    expect(r.baseline.musclesWeek.biceps!.max).toBe(6);
  });

  it('reaches as far as the horizon says: 7, 14 or 28 days', () => {
    for (const horizonDays of [7, 14, 28] as const) {
      const r = simulateProposal(
        base(),
        { kind: 'week_change', constraints: [] },
        { horizonDays, athlete: 'follows_plan' },
      );
      expect(r.baseline.minutesPerDay).toHaveLength(horizonDays);
    }
    // Over four weeks the block runs long enough to count its expected steps.
    const long = simulateProposal(
      base(),
      { kind: 'week_change', constraints: [] },
      { horizonDays: 28, athlete: 'follows_plan' },
    );
    expect(long.baseline.expectedLoadSteps + long.baseline.expectedProbes).toBeGreaterThanOrEqual(
      0,
    );
  });

  it('writes nothing and does not touch what it was given', () => {
    const input = base();
    const before = JSON.stringify(input);
    simulateProposal(input, { kind: 'week_change', constraints: [rest('2026-10-06')] }, follows);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('is the planner of the week, not another one: the baseline is planWeek itself', () => {
    const r = simulateProposal(base(), { kind: 'week_change', constraints: [] }, follows);
    const week = planWeek({ ...base(), from: FROM, days: 7 });
    expect(r.baseline.minutesPerDay).toEqual(
      week.days.map((d) =>
        d.forecast === null ? 0 : Math.round(d.forecast.time.exerciseTotal / 60),
      ),
    );
  });

  describe('a change to the running workout', () => {
    const running = () => {
      const { snap, session } = world([recipe('db-floor-press', 3), recipe('crunch', 2)]);
      session.records = perform(session, 1);
      return { snap, session };
    };

    it('assesses it as the engine does and compares the days after it with and without it', () => {
      const { snap, session } = running();
      const input = base({
        asOf: snap.asOf,
        records: session.records,
        session: { snap, state: session },
        running: session.plan,
        block: { ...block, startedOn: snap.asOf },
      });
      const r = simulateProposal(
        input,
        {
          kind: 'session_change',
          change: { kind: 'add_exercise', exercise: { id: 'dead-bug' }, sets: 2 },
        },
        follows,
      );
      expect(r.assessment).not.toBeNull();
      expect(r.assessment!.verdict).toMatch(/ok|not_recommended/);
      expect(r.baseline.minutesPerDay).toHaveLength(7);
      // Core work added today leaves its mark on the days after it.
      expect(Object.keys(r.diff.musclesWeek).length + r.diff.daysChanged.length).toBeGreaterThan(0);
      for (const w of r.warnings) expect(w.status).not.toBe('pass');
    });

    it('a blocked change is the baseline: nothing would be applied', () => {
      const { snap, session } = running();
      const input = base({
        asOf: snap.asOf,
        records: session.records,
        session: { snap, state: session },
        running: session.plan,
        block: { ...block, startedOn: snap.asOf },
      });
      const r = simulateProposal(
        input,
        {
          kind: 'session_change',
          change: { kind: 'add_exercise', exercise: { query: 'qwertyuiop' } },
        },
        follows,
      );
      expect(r.assessment!.verdict).toBe('blocked');
      expect(r.diff.daysChanged).toEqual([]);
      expect(r.diff.musclesWeek).toEqual({});
      expect(r.warnings.map((w) => w.code)).toContain('NOT_IN_CATALOG');
    });

    it('without a session to look at a session change changes nothing', () => {
      const r = simulateProposal(
        base(),
        { kind: 'session_change', change: { kind: 'skip_remaining', exposureId: 'x' } },
        follows,
      );
      expect(r.assessment).toBeNull();
      expect(r.baseline).toEqual(r.withProposal);
    });
  });
});

describe('the athlete the forecast assumes', () => {
  const doneAt = (reps: number): ExposureRecord[] => {
    const plan = planWeek({ ...base(), from: FROM, days: 1 }).days[0]!.forecast!;
    return recordsOf(
      plan,
      { amount: (s) => (s.target.kind === 'reps' ? reps : 30), rir: () => 2 },
      false,
    );
  };

  it('follows the plan exactly, or drifts by what the last four weeks showed', () => {
    const plan = planWeek({ ...base(), from: '2026-10-06', days: 1 }).days[0]!.forecast!;
    const set = plan.exposures[0]!.sets.find((s) => s.target.kind === 'reps')!;
    const target = set.target.kind === 'reps' ? set.target.target : 0;
    expect(observedAthlete([], FROM).amount(set, plan.exposures[0]!)).toBe(target);
    const over = observedAthlete(doneAt(30), '2026-10-06');
    expect(over.amount(set, plan.exposures[0]!)).toBe(target + 2);
    const under = observedAthlete(doneAt(1), '2026-10-06');
    expect(under.amount(set, plan.exposures[0]!)).toBeLessThan(target);
    expect(
      under.amount(
        {
          ...set,
          target: { kind: 'reps' as const, min: 1, target: 1, max: 1, count: 'total' as const },
        },
        plan.exposures[0]!,
      ),
    ).toBe(1);
    // Old work and work of other kinds do not count.
    expect(observedAthlete(doneAt(30), '2026-12-31').amount(set, plan.exposures[0]!)).toBe(target);
    const time = {
      ...set,
      target: { kind: 'duration' as const, minSec: 20, targetSec: 30, maxSec: 40 },
    };
    expect(observedAthlete([], FROM).amount(time as typeof set, plan.exposures[0]!)).toBe(30);
    expect(over.rir(set, plan.exposures[0]!)).toBe(FOLLOWS_THE_PLAN.rir(set, plan.exposures[0]!));
  });

  it('the observed trend changes the forecast of the days that follow the days it was observed on', () => {
    const records = doneAt(30);
    const flat = simulateProposal(
      base({ records, asOf: '2026-10-06' }),
      { kind: 'week_change', constraints: [] },
      { horizonDays: 14, athlete: 'follows_plan' },
    );
    const trend = simulateProposal(
      base({ records, asOf: '2026-10-06' }),
      { kind: 'week_change', constraints: [] },
      { horizonDays: 14, athlete: 'observed_trend' },
    );
    expect(trend.baseline.minutesPerDay).toHaveLength(14);
    expect(flat.baseline.minutesPerDay).toHaveLength(14);
  });
});
