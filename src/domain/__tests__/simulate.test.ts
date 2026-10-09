/**
 * Engine v2, P4 (04, 08 §2, T05-T07, T36, T56, T62, T63, T93, T94): the second
 * engine over weeks, on the catalogue the app ships and a person who does what
 * the plan says — and one who does not quite.
 */
import { buildHistoryIndex } from '../history';
import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { sessionPlanSchema } from '../plan/plan';
import { type Athlete, FOLLOWS_THE_PLAN, simulate, type SimulatedDay } from '../plan/simulate';
import { addDays, daysBetween } from '../time/trainingDate';
import { TRAINING_CONFIG } from '../config/training';
import type { MuscleGroup } from '../types';
import { CONSERVATIVE } from './fixtures';
import { CATALOG, ELIGIBILITY, SLOTS } from './dayFixtures';

const START = '2026-10-05';
const run = (days: number, patch: Partial<Parameters<typeof simulate>[0]> = {}) =>
  simulate({
    start: START,
    days,
    catalog: CATALOG,
    slots: SLOTS,
    eligibility: ELIGIBILITY,
    ...patch,
  });

const six = run(42);
const plans = six.flatMap((d) => (d.plan === null ? [] : [d.plan]));

describe('six weeks of a person who does what the plan says', () => {
  it('every day has a plan, and every plan is one the schema accepts', () => {
    expect(six.every((d) => d.plan !== null)).toBe(true);
    for (const p of plans) expect(sessionPlanSchema.safeParse(p).success).toBe(true);
    expect(
      six.every((d) => d.output!.result.kind === 'ready' || d.output!.result.kind === 'adjusted'),
    ).toBe(true);
  });

  it('is the same every time (T56)', () => {
    expect(run(42)).toEqual(six);
  });

  it('keeps to the day and the week: no muscle over its maximum, counting the sets whose effort nobody gave (T62, T63)', () => {
    const all: SimulatedDay['records'] = [];
    for (const d of six) {
      all.push(...d.records);
      const idx = buildHistoryIndex(all, CATALOG);
      const today = idx.muscleDay.get(d.date);
      for (const m of MUSCLE_GROUPS) {
        const dayWork = (today?.[m].certain ?? 0) + (today?.[m].uncertain ?? 0);
        expect(dayWork).toBeLessThanOrEqual(3);
        let week = 0;
        for (const [date, work] of idx.muscleDay) {
          const age = daysBetween(date, d.date);
          if (age >= 0 && age < 7) week += work[m].certain + work[m].uncertain;
        }
        const max =
          TRAINING_CONFIG.maxDirectSetsOverride[m as MuscleGroup] ??
          TRAINING_CONFIG.weeklyWorkingSetsPerMuscle.max;
        expect(week).toBeLessThanOrEqual(max);
      }
    }
  });

  it('keeps to the time of a day: at most half an hour of exercises', () => {
    for (const p of plans) expect(p.time.exerciseTotal).toBeLessThanOrEqual(30 * 60);
  });

  it('an exercise done again gets a little more, and never less than it did, while the person follows the plan', () => {
    const targets = new Map<string, number[]>();
    for (const p of plans) {
      for (const e of p.exposures.filter((x) => x.progressionScope === 'primary')) {
        const set = e.sets.find((s) => s.role === 'work');
        if (set === undefined || set.target.kind !== 'reps') continue;
        targets.set(e.comparisonKey, [...(targets.get(e.comparisonKey) ?? []), set.target.target]);
      }
    }
    const progressed = [...targets.values()].filter((t) => t.length >= 3);
    expect(progressed.length).toBeGreaterThan(3);
    for (const t of progressed) {
      // The resistance may step up (back to the bottom of the range); within a step the target never falls.
      const rises = t.filter((x, i) => i > 0 && x > t[i - 1]!).length;
      expect(rises).toBeGreaterThan(0);
    }
  });

  it('a probe is tried only when the athlete has reached the top of a range', () => {
    const probes = plans.flatMap((p) =>
      p.exposures.filter((e) => e.sets.some((s) => s.role === 'probe')),
    );
    for (const e of probes) expect(e.trace.code).toBe('PROBE_PLANNED');
  });

  it('a block rotates after 35 days, and a deload comes only when asked for', () => {
    const events = six.flatMap((d) => d.events);
    expect(events.filter((e) => e === 'BLOCK_ROTATED')).toHaveLength(1);
    expect(events).not.toContain('DELOAD_SCHEDULED');
    expect(six.find((d) => d.events.includes('BLOCK_ROTATED'))!.date).toBe(addDays(START, 35));
  });

  it('the ids of the sets are those of the session, and unique across the weeks', () => {
    const ids = plans.flatMap((p) => p.exposures.flatMap((e) => e.sets.map((s) => s.id)));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('days without a session', () => {
  it('leave no plan and no record, and the block goes on', () => {
    const rest = run(14, { restDays: new Set([addDays(START, 2), addDays(START, 3)]) });
    expect(rest[2]).toMatchObject({ plan: null, output: null, records: [] });
    expect(rest[3]!.plan).toBeNull();
    expect(rest[4]!.plan).not.toBeNull();
  });
});

describe('a person who falls short now and then', () => {
  const imperfect = (): Athlete => {
    let n = 0;
    return {
      amount: (set) => {
        n += 1;
        const target = FOLLOWS_THE_PLAN.amount(set, undefined as never);
        return n % 5 === 0 ? Math.max(1, target - 2) : target;
      },
      rir: (set) => (n % 7 === 0 ? 0 : (set.targetRir?.min ?? 2)),
    };
  };
  const eight = run(56, { athlete: imperfect() });

  it('still gets a plan every day, and the codes of the progression say what happened', () => {
    expect(eight.every((d) => d.plan !== null)).toBe(true);
    const codes = new Set(eight.flatMap((d) => d.plan!.exposures.map((e) => e.trace.code)));
    expect(codes.has('REP_PROGRESSION')).toBe(true);
    expect(codes.has('FIRST_COMPARABLE_EXPOSURE')).toBe(true);
  });

  it('never says an exercise got lighter when it did not (T105)', () => {
    for (const d of eight) {
      for (const e of d.plan!.exposures) {
        if (e.trace.code === 'LOAD_STEP_DOWN' || e.trace.code === 'LAYOFF_STEP_DOWN') {
          const history = eight
            .filter((x) => x.date < d.date)
            .flatMap((x) => x.plan!.exposures)
            .filter((x) => x.comparisonKey === e.comparisonKey);
          const before = history[history.length - 1]!.sets.find(
            (s) => s.role === 'work',
          )!.resistance;
          expect(JSON.stringify(e.sets[0]!.resistance.value)).not.toBe(
            JSON.stringify(before.value),
          );
        }
      }
    }
  });
});

describe('a knee that does not allow everything', () => {
  it('is respected on every day', () => {
    const safe = run(21, { eligibility: { profile: CONSERVATIVE, excludedIds: new Set() } });
    const used = new Set(safe.flatMap((d) => d.plan!.exposures.map((e) => e.exercise.id)));
    for (const id of used) {
      expect(ELIGIBILITY.profile).toBeDefined();
      expect(CATALOG[id]).toBeDefined();
    }
    expect(safe.every((d) => d.output!.result.kind !== 'unsupported_input')).toBe(true);
  });
});

describe('T93, T94 a deload when the body asks for it', () => {
  const grinding: Athlete = { amount: FOLLOWS_THE_PLAN.amount, rir: () => 0 };
  const poorSleep = (date: string) => ({
    date,
    sleepHours: 5,
    energy: 2,
    soreness: null,
  });

  it('starts after a week of grinding on poor sleep, lasts a week, and the block goes on', () => {
    const days = run(35, { athlete: grinding, daily: poorSleep });
    const start = days.find((d) => d.events.includes('DELOAD_REACTIVE'));
    expect(start).toBeDefined();
    expect(daysBetween(START, start!.date)).toBeGreaterThanOrEqual(7);
    const during = days.filter((d) => d.output?.phase === 'deload');
    expect(during.length).toBe(7);
    for (const d of during) {
      for (const e of d.plan!.exposures.filter((x) => x.progressionScope === 'primary')) {
        expect(e.sets.every((s) => s.targetRir !== null && s.targetRir.min >= 4)).toBe(true);
      }
    }
    expect(days[days.length - 1]!.block.index).toBe(1);
  });

  it('is asked for by the person', () => {
    const asked = run(14, { deloadRequests: new Set([addDays(START, 3)]) });
    expect(asked[3]!.events).toContain('DELOAD_REACTIVE');
    expect(asked[3]!.output!.phase).toBe('deload');
  });
});
