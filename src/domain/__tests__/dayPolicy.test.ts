/**
 * Engine v2, P0.4 (13 §2, tests T05 and T06): one effective configuration
 * for the engine's own day, an extra session and a composed day.
 */
import { PLANNER_CONFIG, type PlannerConfig, TRAINING_CONFIG } from '../config/training';
import { composeDay, dayOptions } from '../plan/compose';
import type { PlanConstraint } from '../plan/constraints';
import { planMinutes } from '../plan/estimate';
import { selectDay } from '../plan/dayPlanner';
import { extraSessionOptions, planCustom, selectCustom } from '../plan/extra';
import { planWeek, type WeekInput } from '../plan/week';
import { BASE_POLICY, type PlanIntent, resolveDayPolicy } from '../policy/dayPolicy';
import { extraInput } from './extraFixtures';

const DATE = '2026-10-08';
const ALL_SLOTS = ['legs', 'push', 'pull', 'core'];

/** One exercise is about 5 minutes; a 6-minute session has room for exactly one. */
const TIGHT: PlannerConfig = {
  ...PLANNER_CONFIG,
  sessionMinutes: { min: 0, target: 6, max: 6 },
};
const TIGHT_BASE = { planner: TIGHT, training: TRAINING_CONFIG };

const request = (patch: Partial<PlanConstraint>): PlanConstraint => ({
  id: 'r',
  kind: 'avoid_muscle',
  muscles: ['chest'],
  from: DATE,
  until: DATE,
  reason: 'pain',
  source: 'user',
  note: null,
  ...patch,
});
const compose = (items: { slotId: string; sets: number }[]): PlanConstraint =>
  request({ id: 'compose', kind: 'compose_day', muscles: [], reason: 'other', items });

describe('resolveDayPolicy', () => {
  it('hands the engine its own day the base numbers when every day trains', () => {
    const policy = resolveDayPolicy(BASE_POLICY, undefined, 'auto_day');
    expect(policy).toEqual({ ...BASE_POLICY, intent: 'auto_day' });
  });

  it('spreads the weekly target over fewer training days, inside the day limits', () => {
    // Five training days: 20 min x 7 / 5 = 28.
    const five = resolveDayPolicy(BASE_POLICY, { restWeekdays: [2, 5] }, 'auto_day');
    expect(five.planner.sessionMinutes).toEqual({ min: 20, target: 28, max: 30 });
    // Three training days: 47 min is capped by the day's maximum.
    const three = resolveDayPolicy(BASE_POLICY, { restWeekdays: [0, 2, 4, 6] }, 'auto_day');
    expect(three.planner.sessionMinutes.target).toBe(30);
  });

  it.each<PlanIntent>(['extra', 'compose', 'session_change'])(
    'lets an explicit %s exceed the weekly target and ignore staleness, but not the maximum',
    (intent) => {
      const policy = resolveDayPolicy(BASE_POLICY, { restWeekdays: [2, 5] }, intent);
      expect(policy.intent).toBe(intent);
      expect(policy.planner.sessionMinutes).toEqual({ min: 0, target: 30, max: 30 });
      expect(policy.planner.forceStaleDays).toBe(0);
    },
  );

  it('keeps a template as it is: the same numbers as the engine day', () => {
    const week = { restWeekdays: [2, 5] };
    expect(resolveDayPolicy(BASE_POLICY, week, 'template').planner).toEqual(
      resolveDayPolicy(BASE_POLICY, week, 'auto_day').planner,
    );
  });

  it('T05 takes the caller’s base for every intent: same maximum, same direct-set limit, same training config', () => {
    const base = {
      planner: { ...TIGHT, maxDirectSetsPerMuscleDay: 1 },
      training: TRAINING_CONFIG,
    };
    for (const intent of ['auto_day', 'extra', 'compose', 'template', 'session_change'] as const) {
      for (const week of [undefined, { restWeekdays: [1, 3, 5] }]) {
        const policy = resolveDayPolicy(base, week, intent);
        expect(policy.planner.sessionMinutes.max).toBe(6);
        expect(policy.planner.maxDirectSetsPerMuscleDay).toBe(1);
        expect(policy.training).toBe(TRAINING_CONFIG);
      }
    }
  });
});

describe('T05 a limited day is limited the same way on every path', () => {
  const week = (patch: Partial<WeekInput> = {}): WeekInput => {
    const { asOf: _, ...day } = extraInput();
    return { ...day, from: DATE, days: 2, lastSessionDate: null, ...patch };
  };
  const minutesOf = (plan: ReturnType<typeof planCustom>, input = extraInput()) =>
    planMinutes(plan.exercises, input.catalog, TIGHT);

  it('the engine’s own day, an extra session and a composed day each fit the 6 minutes', () => {
    const input = extraInput();
    const auto = selectDay(input, TIGHT);
    const extra = selectCustom(input, ALL_SLOTS, resolveDayPolicy(TIGHT_BASE, undefined, 'extra'));
    const composed = composeDay(
      input,
      ALL_SLOTS.map((slotId) => ({ slotId, sets: 2 })),
      resolveDayPolicy(TIGHT_BASE, undefined, 'compose'),
    ).selection;
    expect(auto.items).toHaveLength(1);
    expect(extra.items).toHaveLength(1);
    expect(composed.items).toHaveLength(1);
  });

  it('an extra session asked without a policy uses the global config; with the day’s policy the maximum holds', () => {
    // The caller’s config is the global one here, so the default is the global config: 4 movements fit.
    const input = extraInput();
    expect(selectCustom(input, ALL_SLOTS).items).toHaveLength(4);
    // The same call with the tight policy is what the week planner now makes for a composed day.
    expect(
      selectCustom(input, ALL_SLOTS, resolveDayPolicy(TIGHT_BASE, undefined, 'extra')).items,
    ).toHaveLength(1);
  });

  it('planWeek passes its own config to the composed day, not the global one', () => {
    const days = planWeek(
      week({ constraints: [compose(ALL_SLOTS.map((slotId) => ({ slotId, sets: 2 })))] }),
      TIGHT,
    ).days;
    const [composed, own] = days;
    expect(composed!.composed).toBe(true);
    expect(composed!.selection!.items).toHaveLength(1);
    expect(own!.selection!.items).toHaveLength(1);
    for (const day of days) {
      expect(planMinutes(day.forecast!.exercises, extraInput().catalog, TIGHT)).toBeLessThanOrEqual(
        6,
      );
    }
  });

  it('planWeek lists the options of a day under the same config', () => {
    const options = planWeek(week({ optionsFor: DATE }), TIGHT).days[0]!.options!;
    expect(options.map((o) => [o.slotId, o.available])).toEqual([
      ['legs', true],
      ['push', true],
      ['pull', true],
      ['core', true],
    ]);
    // Each movement alone fits the 6 minutes; asked for two, only one is taken.
    expect(
      composeDay(
        extraInput(),
        [
          { slotId: 'legs', sets: 2 },
          { slotId: 'push', sets: 2 },
        ],
        resolveDayPolicy(TIGHT_BASE, undefined, 'compose'),
      ).selection.items.map((i) => i.slotId),
    ).toHaveLength(1);
  });

  it('planCustom builds under the policy it selected with', () => {
    const input = extraInput();
    const plan = planCustom(input, ALL_SLOTS, resolveDayPolicy(TIGHT_BASE, undefined, 'extra'));
    expect(plan.exercises).toHaveLength(1);
    expect(minutesOf(plan)).toBeLessThanOrEqual(6);
  });

  it('the week pattern on the input reaches the default policy of an extra session', () => {
    const input = extraInput({ week: { restWeekdays: [2, 5] } });
    expect(selectCustom(input, ALL_SLOTS).items).toEqual(
      selectCustom(extraInput(), ALL_SLOTS).items,
    );
  });
});

describe('T06 a request means the same on every path', () => {
  const chestIsOut = (constraints: PlanConstraint[], date = DATE) => {
    const input = extraInput({ asOf: date, constraints });
    const reasonOf = (skipped: { slotId: string; reason: string }[]) =>
      skipped.find((s) => s.slotId === 'push')?.reason ?? null;
    const policy = resolveDayPolicy(BASE_POLICY, undefined, 'compose');
    return {
      auto: reasonOf(selectDay(input).skipped),
      extra: reasonOf(selectCustom(input, ALL_SLOTS).skipped),
      composed: reasonOf(
        composeDay(input, [{ slotId: 'push', sets: 2 }], policy).conflicts as {
          slotId: string;
          reason: string;
        }[],
      ),
      options: dayOptions(input).find((o) => o.slotId === 'push')!.reason,
      extraOptions: extraSessionOptions(input).find((o) => o.slotId === 'push')!.reason,
    };
  };

  it('an avoid request leaves the muscle out of the engine’s day, an extra, a composition and the options', () => {
    expect(chestIsOut([request({})])).toEqual({
      auto: 'AVOIDED_BY_REQUEST',
      extra: 'AVOIDED_BY_REQUEST',
      composed: 'AVOIDED_BY_REQUEST',
      options: 'AVOIDED_BY_REQUEST',
      extraOptions: 'AVOIDED_BY_REQUEST',
    });
  });

  it('it lapses the day after `until` for all of them', () => {
    expect(chestIsOut([request({ until: DATE })], '2026-10-09')).toEqual({
      auto: null,
      extra: null,
      composed: null,
      options: null,
      extraOptions: null,
    });
  });

  it('it is gone for all of them once taken back', () => {
    expect(chestIsOut([])).toEqual({
      auto: null,
      extra: null,
      composed: null,
      options: null,
      extraOptions: null,
    });
  });

  it('a lighter day gives one set on the engine’s day and on an extra session alike', () => {
    const input = extraInput({ constraints: [request({ kind: 'lighter_day', muscles: [] })] });
    const setsOf = (items: { sets: number; role: string }[]) =>
      items.filter((i) => i.role === 'work').map((i) => i.sets);
    expect(setsOf(selectDay(input).items).every((s) => s === 1)).toBe(true);
    expect(setsOf(selectCustom(input, ALL_SLOTS).items).every((s) => s === 1)).toBe(true);
    expect(selectCustom(input, ALL_SLOTS).items.length).toBeGreaterThan(0);
  });
});
