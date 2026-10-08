import { PLANNER_CONFIG } from '../config/training';
import {
  avoidedOn,
  constraintsOn,
  dateRange,
  isAvoided,
  isLighterDay,
  isTrainingDay,
  overrideDay,
  type PlanConstraint,
  scaledConfig,
  TRAIN_DAILY,
  weekdayOf,
} from '../plan/constraints';
import { exercise } from './fixtures';

const constraint = (patch: Partial<PlanConstraint>): PlanConstraint => ({
  id: 'c',
  kind: 'avoid_muscle',
  muscles: [],
  from: '2026-10-08',
  until: '2026-10-09',
  reason: 'doms',
  source: 'user',
  note: null,
  ...patch,
});

describe('constraints', () => {
  it('numbers the week from Monday', () => {
    expect(weekdayOf('2026-10-05')).toBe(0); // a Monday
    expect(weekdayOf('2026-10-11')).toBe(6);
    expect(weekdayOf('2023-12-31')).toBe(6); // before the reference Monday too
  });

  it('applies a constraint on every day of its range, both ends included', () => {
    const c = constraint({});
    expect(constraintsOn([c], '2026-10-07')).toEqual([]);
    expect(constraintsOn([c], '2026-10-08')).toEqual([c]);
    expect(constraintsOn([c], '2026-10-09')).toEqual([c]);
    expect(constraintsOn([c], '2026-10-10')).toEqual([]);
  });

  it('leaves out a muscle with DOMS as a primary one, a sore one entirely', () => {
    const avoided = avoidedOn(
      [
        constraint({ muscles: ['quads'], reason: 'doms' }),
        constraint({ muscles: ['back'], reason: 'pain' }),
        constraint({ kind: 'lighter_day' }),
      ],
      '2026-10-08',
    );
    expect([...avoided.primary].sort()).toEqual(['back', 'quads']);
    expect([...avoided.any]).toEqual(['back']);

    const squat = exercise({ primaryMuscles: ['glutes'], secondaryMuscles: ['quads'] });
    const row = exercise({ primaryMuscles: ['lats'], secondaryMuscles: ['back'] });
    const press = exercise({ primaryMuscles: ['quads'], secondaryMuscles: [] });
    expect(isAvoided(squat, avoided)).toBe(false); // secondary work helps DOMS recover
    expect(isAvoided(row, avoided)).toBe(true);
    expect(isAvoided(press, avoided)).toBe(true);
  });

  it('rests on the weekly pattern unless a single day says otherwise', () => {
    const week = { restWeekdays: [6] }; // Sunday
    expect(isTrainingDay('2026-10-10', week, [])).toBe(true);
    expect(isTrainingDay('2026-10-11', week, [])).toBe(false);
    const train = constraint({ kind: 'train_day', from: '2026-10-11', until: '2026-10-11' });
    expect(isTrainingDay('2026-10-11', week, [train])).toBe(true);
    const rest = constraint({ kind: 'rest_day', from: '2026-10-10', until: '2026-10-10' });
    expect(isTrainingDay('2026-10-10', TRAIN_DAILY, [rest])).toBe(false);
  });

  it('knows a lighter day', () => {
    const lighter = constraint({ kind: 'lighter_day' });
    expect(isLighterDay([lighter], '2026-10-08')).toBe(true);
    expect(isLighterDay([lighter], '2026-10-10')).toBe(false);
  });

  it('spreads the weekly minutes over fewer training days, inside the day limits', () => {
    expect(scaledConfig(TRAIN_DAILY)).toBe(PLANNER_CONFIG);
    expect(scaledConfig({ restWeekdays: [5, 6] }).sessionMinutes.target).toBe(28);
    expect(scaledConfig({ restWeekdays: [1, 3, 5, 6] }).sessionMinutes.target).toBe(30);
    expect(scaledConfig({ restWeekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe(PLANNER_CONFIG);
    const generous = { ...PLANNER_CONFIG, sessionMinutes: { min: 25, target: 1, max: 30 } };
    expect(scaledConfig({ restWeekdays: [6] }, generous).sessionMinutes.target).toBe(25);
  });

  it('lists the dates of a range', () => {
    expect(dateRange('2026-10-30', 3)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });
});

describe('overriding one calendar day', () => {
  const coachRest = (id: string, from: string, until: string): PlanConstraint => ({
    id,
    kind: 'rest_day',
    muscles: [],
    from,
    until,
    reason: 'busy',
    source: 'coach',
    note: 'Wyjazd',
  });
  const userDay = (id: string, kind: 'rest_day' | 'train_day', date: string): PlanConstraint => ({
    id,
    kind,
    muscles: [],
    from: date,
    until: date,
    reason: kind === 'rest_day' ? 'busy' : 'other',
    source: 'user',
    note: null,
  });
  const userChoice = (date: string, train: boolean) => ({
    kind: train ? 'train_day' : 'rest_day',
    muscles: [],
    from: date,
    until: date,
    reason: train ? 'other' : 'busy',
    source: 'user',
    note: null,
  });

  it('adds a rest day and replaces an earlier choice for that day only', () => {
    const active = [
      userDay('t', 'train_day', '2026-10-08'),
      userDay('o', 'rest_day', '2026-10-09'),
    ];
    expect(overrideDay(active, '2026-10-08', false)).toEqual({
      revoke: ['t'],
      add: [userChoice('2026-10-08', false)],
    });
  });

  it('keeps a coach rest request when the person also rests', () => {
    expect(overrideDay([coachRest('c', '2026-10-07', '2026-10-09')], '2026-10-08', false)).toEqual({
      revoke: [],
      add: [userChoice('2026-10-08', false)],
    });
  });

  it('takes one day out of a coach rest request, keeping the days around it', () => {
    const { revoke, add } = overrideDay(
      [coachRest('c', '2026-10-07', '2026-10-09')],
      '2026-10-08',
      true,
    );
    expect(revoke).toEqual(['c']);
    expect(add).toEqual([
      expect.objectContaining({ source: 'coach', from: '2026-10-07', until: '2026-10-07' }),
      expect.objectContaining({ source: 'coach', from: '2026-10-09', until: '2026-10-09' }),
      userChoice('2026-10-08', true),
    ]);
  });

  it.each([
    ['first day', '2026-10-08', '2026-10-10', [['2026-10-09', '2026-10-10']]],
    ['last day', '2026-10-06', '2026-10-08', [['2026-10-06', '2026-10-07']]],
    ['single day', '2026-10-08', '2026-10-08', []],
  ])('trims a coach request at its %s', (_, from, until, kept) => {
    const { add } = overrideDay([coachRest('c', from, until)], '2026-10-08', true);
    expect(add.filter((c) => c.source === 'coach').map((c) => [c.from, c.until])).toEqual(kept);
  });

  it('handles overlapping requests and never touches muscle restrictions or other dates', () => {
    const sore: PlanConstraint = {
      ...coachRest('m', '2026-10-08', '2026-10-09'),
      kind: 'avoid_muscle',
      muscles: ['quads'],
      reason: 'pain',
      source: 'user',
    };
    const { revoke } = overrideDay(
      [
        coachRest('a', '2026-10-07', '2026-10-08'),
        coachRest('b', '2026-10-08', '2026-10-10'),
        coachRest('later', '2026-10-12', '2026-10-13'),
        userDay('r', 'rest_day', '2026-10-08'),
        { ...userDay('range', 'rest_day', '2026-10-08'), until: '2026-10-09' },
        sore,
      ],
      '2026-10-08',
      true,
    );
    expect(revoke).toEqual(['a', 'b', 'r']);
  });
});
