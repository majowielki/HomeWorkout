/**
 * SPEC §11: the week ahead on the shipped catalogue and slots, the
 * documented knee with hard exclusions only.
 */
import exercisesJson from '@data/exercises.json';
import slotsJson from '@data/slots.json';
import { slotCatalogueSchema } from '@data/slots.schema';

import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { PLANNER_CONFIG } from '../config/training';
import type { PlanConstraint } from '../plan/constraints';
import { buildDay, checkSelection, type PlannerInput, selectDay } from '../plan/dayPlanner';
import type { EligibilityContext } from '../plan/eligibility';
import { simulate } from '../plan/simulate';
import type { BlockState, DaySelection, SessionPlan } from '../plan/types';
import { planWeek, type WeekInput } from '../plan/week';
import type { HistorySession } from '../progression/history';
import { addDays } from '../time/trainingDate';
import type { Exercise } from '../types';
import { maxDirectSets } from '../volume/weekly';
import { HARD_ONLY } from './fixtures';

const exercises = (exercisesJson as { exercises: Exercise[] }).exercises;
const catalog = Object.fromEntries(exercises.map((e) => [e.id, e]));
const { slots } = slotCatalogueSchema.parse(slotsJson);
const eligibility: EligibilityContext = { profile: HARD_ONLY, excludedIds: new Set() };
const MONDAY = '2026-10-05';
/** Block 1 as it opens on Monday. */
const FIRST_BLOCK: BlockState = simulate({
  start: MONDAY,
  days: 1,
  catalog,
  slots,
  eligibility,
})[0]!.block;

const input = (patch: Partial<WeekInput> = {}): WeekInput => ({
  from: MONDAY,
  days: 7,
  catalog,
  slots,
  eligibility,
  block: null,
  sessions: [],
  lastSessionDate: null,
  rides: [],
  daily: [],
  ...patch,
});

const keptFrom = (days: { date: string; selection: DaySelection | null }[]) =>
  Object.fromEntries(days.flatMap((d) => (d.selection ? [[d.date, d.selection]] : [])));

const constraint = (patch: Partial<PlanConstraint>): PlanConstraint => ({
  id: 'c',
  kind: 'avoid_muscle',
  muscles: [],
  from: MONDAY,
  until: addDays(MONDAY, 6),
  reason: 'doms',
  source: 'user',
  note: null,
  ...patch,
});

const workMuscles = (s: DaySelection | null) =>
  (s?.items ?? [])
    .filter((i) => i.role === 'work')
    .flatMap((i) => catalog[i.exerciseId]!.primaryMuscles);

describe('planWeek', () => {
  const first = planWeek(input());

  it('plans the same days the day planner plans one after another', () => {
    const daily = simulate({ start: MONDAY, days: 7, catalog, slots, eligibility });
    expect(first.days.map((d) => d.forecast?.exercises)).toEqual(
      daily.map((d) => d.plan?.exercises),
    );
    expect(first.days.every((d) => d.status === 'new' && !d.rest)).toBe(true);
    expect(first.days[0]!.events).toEqual(['BLOCK_STARTED']);
  });

  it('never goes over a weekly maximum in the days it plans', () => {
    for (const m of MUSCLE_GROUPS) expect(first.volume[m]).toBeLessThanOrEqual(maxDirectSets(m));
    expect(Object.values(first.volume).some((v) => v > 0)).toBe(true);
  });

  it('keeps every day chosen earlier while it still holds', () => {
    const again = planWeek(input({ kept: keptFrom(first.days) }));
    expect(again.days.every((d) => d.status === 'kept')).toBe(true);
    expect(again.days.map((d) => d.selection)).toEqual(first.days.map((d) => d.selection));
  });

  it('chooses again only the days that no longer hold, and says why', () => {
    // Monday as planned, plus an extra session with Tuesday's hard work.
    const asDone = (plan: SessionPlan) =>
      plan.exercises
        .filter((e) => e.targetRirMin <= 4)
        .map((e) => ({
          exerciseId: e.exerciseId,
          isWarmup: false,
          reps: e.unit === 'reps' ? e.target : null,
          timeSec: e.unit === 'sec' ? e.target : null,
          rir: e.targetRirMin,
          load: e.load,
        }));
    const extra = asDone(first.days[1]!.forecast!);
    const monday: HistorySession = {
      date: MONDAY,
      sets: [...asDone(first.days[0]!.forecast!), ...extra],
    };
    const rest = planWeek(
      input({
        from: addDays(MONDAY, 1),
        days: 6,
        block: FIRST_BLOCK,
        sessions: [monday],
        lastSessionDate: MONDAY,
        kept: keptFrom(first.days),
      }),
    );
    const tue = rest.days[0]!;
    expect(tue.status).toBe('changed');
    expect(tue.violations.map((v) => v.code)).toContain('RECOVERING');
    const trainedMonday = new Set(extra.flatMap((s) => catalog[s.exerciseId]!.primaryMuscles));
    expect(workMuscles(tue.selection).filter((m) => trainedMonday.has(m))).toEqual([]);
    // The rest of the week still holds: only Tuesday changes.
    expect(rest.days.slice(1).every((d) => d.status === 'kept')).toBe(true);
  });

  it('rests on the weekly pattern and on a day asked for', () => {
    const week = planWeek(
      input({
        week: { restWeekdays: [6] },
        constraints: [
          constraint({ kind: 'rest_day', from: addDays(MONDAY, 2), until: addDays(MONDAY, 2) }),
        ],
        kept: keptFrom(first.days),
      }),
    );
    const restDays = week.days.filter((d) => d.rest).map((d) => d.date);
    expect(restDays).toEqual([addDays(MONDAY, 2), addDays(MONDAY, 6)]);
    const wednesday = week.days[2]!;
    expect(wednesday).toMatchObject({ selection: null, forecast: null, status: 'changed' });
    expect(wednesday.violations).toEqual([{ slotId: null, code: 'REST_DAY' }]);
    expect(planWeek(input({ week: { restWeekdays: [6] } })).days[6]!.status).toBe('new');
  });

  it('leaves out the muscles asked for, and only on their days', () => {
    const avoid = constraint({ muscles: ['quads', 'glutes'], until: addDays(MONDAY, 2) });
    const week = planWeek(input({ constraints: [avoid] }));
    for (const day of week.days.slice(0, 3)) {
      expect(workMuscles(day.selection).filter((m) => m === 'quads' || m === 'glutes')).toEqual([]);
    }
    expect(week.days[0]!.selection!.skipped.some((s) => s.reason === 'AVOIDED_BY_REQUEST')).toBe(
      true,
    );
    const later = week.days.slice(3).flatMap((d) => workMuscles(d.selection));
    expect(later).toContain('quads');
  });

  it('leaves a sore muscle out of secondary work, light fill and mobility too', () => {
    const sore = constraint({ muscles: ['core', 'back'], reason: 'pain' });
    const week = planWeek(input({ constraints: [sore] }));
    for (const day of week.days) {
      for (const item of day.selection!.items) {
        const e = catalog[item.exerciseId]!;
        expect(
          [...e.primaryMuscles, ...e.secondaryMuscles].filter((m) => m === 'core' || m === 'back'),
        ).toEqual([]);
      }
    }
  });

  it('does one set of everything on a lighter day, and replans a stored day that changed', () => {
    const lighter = constraint({ kind: 'lighter_day', from: MONDAY, until: MONDAY });
    const week = planWeek(input({ constraints: [lighter], kept: keptFrom(first.days) }));
    const monday = week.days[0]!;
    expect(monday.status).toBe('changed');
    expect(monday.violations).toContainEqual({ slotId: null, code: 'REQUEST_CHANGED' });
    expect(
      monday.selection!.items.filter((i) => i.role === 'work').every((i) => i.sets === 1),
    ).toBe(true);
    expect(monday.forecast!.dayReasons).toContain('LIGHTER_DAY_REQUESTED');
  });
});

describe('planWeek — edges', () => {
  it('plans nothing for zero days', () => {
    const empty = planWeek(input({ days: 0 }));
    expect(empty.days).toEqual([]);
    expect(Object.values(empty.volume).every((v) => v === 0)).toBe(true);
  });
});

describe('buildDay', () => {
  it('skips an item whose slot or exercise no longer exists', () => {
    const day: PlannerInput = {
      asOf: MONDAY,
      catalog,
      slots,
      eligibility,
      block: FIRST_BLOCK,
      sessions: [],
      rides: [],
      daily: [],
    };
    const chosen = selectDay(day);
    const ghost: DaySelection = {
      ...chosen,
      items: [...chosen.items, { slotId: 'ghost', exerciseId: 'nope', sets: 1, role: 'work' }],
    };
    expect(buildDay(ghost, day).exercises).toEqual(buildDay(chosen, day).exercises);
  });
});

describe('checkSelection', () => {
  const block = FIRST_BLOCK;
  const day = (patch: Partial<PlannerInput> = {}): PlannerInput => ({
    asOf: MONDAY,
    catalog,
    slots,
    eligibility,
    block,
    sessions: [],
    rides: [],
    daily: [],
    ...patch,
  });
  const chosen = selectDay(day());
  const work = chosen.items.find((i) => i.role === 'work')!;
  const light: DaySelection = {
    ...chosen,
    items: [
      { slotId: 'core-back', exerciseId: block.selections['core-back']!, sets: 2, role: 'light' },
      { slotId: 'mobility', exerciseId: 'cat-cow', sets: 2, role: 'mobility' },
    ],
  };

  it('passes the day it was chosen for', () => {
    expect(checkSelection(chosen, day())).toEqual([]);
    expect(checkSelection(light, day())).toEqual([]);
  });

  it("flags an exercise no longer allowed, or no longer the block's choice", () => {
    const excluded = day({
      eligibility: { ...eligibility, excludedIds: new Set([work.exerciseId]) },
    });
    expect(checkSelection(chosen, excluded)).toContainEqual({
      slotId: work.slotId,
      code: 'NOT_ALLOWED',
    });
    const other = { ...block, selections: { ...block.selections, [work.slotId]: 'nope' } };
    expect(checkSelection(chosen, day({ block: other }))).toContainEqual({
      slotId: work.slotId,
      code: 'SELECTION_CHANGED',
    });
    const swapped: DaySelection = {
      ...chosen,
      items: [{ ...work, swapped: true }],
    };
    expect(checkSelection(swapped, day({ block: other }))).toEqual([]);
  });

  it('flags a rotated block and a day over the limits', () => {
    expect(checkSelection(chosen, day({ block: { ...block, index: 2 } }))).toContainEqual({
      slotId: null,
      code: 'BLOCK_CHANGED',
    });
    const heavy: DaySelection = {
      ...chosen,
      items: [{ ...work, sets: PLANNER_CONFIG.maxDirectSetsPerMuscleDay + 1 }],
    };
    expect(checkSelection(heavy, day())).toContainEqual({ slotId: null, code: 'VOLUME_AT_MAX' });
  });

  it('flags light work on a sore muscle and mobility of a muscle left out', () => {
    const dog = catalog[block.selections['core-back']!]!;
    const sore = day({
      daily: [
        {
          date: MONDAY,
          sleepHours: null,
          energy: null,
          soreness: Object.fromEntries(dog.primaryMuscles.map((m) => [m, 5])),
        },
      ],
    });
    expect(checkSelection(light, sore)).toContainEqual({ slotId: 'core-back', code: 'DOMS_HIGH' });
    const catCow = catalog['cat-cow']!;
    const avoided = day({
      constraints: [constraint({ muscles: [...catCow.primaryMuscles], reason: 'pain' })],
    });
    expect(checkSelection(light, avoided)).toContainEqual({
      slotId: 'mobility',
      code: 'AVOIDED_BY_REQUEST',
    });
  });

  it('flags a missing slot or exercise as not allowed', () => {
    const ghost: DaySelection = {
      ...chosen,
      items: [{ slotId: 'ghost', exerciseId: 'nope', sets: 1, role: 'work' }],
    };
    expect(checkSelection(ghost, day())).toEqual([{ slotId: 'ghost', code: 'NOT_ALLOWED' }]);
  });
});
