import { composeDay, dayOptions } from '../plan/compose';
import type { PlanConstraint } from '../plan/constraints';
import { planWeek, type WeekInput } from '../plan/week';
import type { HistorySet } from '../progression/history';
import { extraInput } from './extraFixtures';

const DATE = '2026-10-08';
const sorePush: PlanConstraint = {
  id: 'r',
  kind: 'avoid_muscle',
  muscles: ['chest'],
  from: DATE,
  until: DATE,
  reason: 'pain',
  source: 'user',
  note: null,
};
const compose = (items: { slotId: string; sets: number }[], from = DATE): PlanConstraint => ({
  id: 'compose',
  kind: 'compose_day',
  muscles: [],
  from,
  until: from,
  reason: 'other',
  source: 'coach',
  note: 'Górna partia',
  items,
});
const pushedYesterday: HistorySet = {
  exerciseId: 'push',
  isWarmup: false,
  reps: 10,
  timeSec: null,
  rir: 2,
  load: { kind: 'bodyweight' },
};

describe('composing a day from the engine options', () => {
  it('takes the movements asked for, never more sets than the engine gives', () => {
    const { selection, conflicts } = composeDay(extraInput(), [
      { slotId: 'push', sets: 1 },
      { slotId: 'pull', sets: 5 },
    ]);
    expect(selection.items.map((i) => [i.slotId, i.sets])).toEqual([
      ['push', 1],
      ['pull', 2],
    ]);
    expect(selection.items.every((i) => i.role === 'work')).toBe(true);
    expect(conflicts).toEqual([]);
  });

  it('reports what it could not take: an unknown or filler movement, a request, recovery', () => {
    const input = extraInput({
      constraints: [sorePush],
      sessions: [{ date: '2026-10-07', sets: [{ ...pushedYesterday, exerciseId: 'pull' }] }],
    });
    const { selection, conflicts } = composeDay(input, [
      { slotId: 'push', sets: 2 },
      { slotId: 'pull', sets: 2 },
      { slotId: 'legs', sets: 2 },
      { slotId: 'legs', sets: 1 },
      { slotId: 'mobility', sets: 2 },
      { slotId: 'nope', sets: 2 },
    ]);
    expect(selection.items.map((i) => [i.slotId, i.sets])).toEqual([['legs', 2]]);
    expect(conflicts).toEqual(
      expect.arrayContaining([
        { slotId: 'mobility', exerciseId: null, reason: 'NO_CANDIDATE' },
        { slotId: 'nope', exerciseId: null, reason: 'NO_CANDIDATE' },
        expect.objectContaining({ slotId: 'push', reason: 'AVOIDED_BY_REQUEST' }),
        expect.objectContaining({ slotId: 'pull', reason: 'RECOVERING' }),
      ]),
    );
    expect(conflicts).toHaveLength(4);
  });

  it('lists every working movement of the day with whether it can be trained and why not', () => {
    const options = dayOptions(extraInput({ constraints: [sorePush] }));
    expect(options.map((o) => o.slotId)).toEqual(['legs', 'push', 'pull', 'core']);
    expect(options.find((o) => o.slotId === 'push')).toEqual({
      slotId: 'push',
      exerciseId: 'push',
      available: false,
      reason: 'AVOIDED_BY_REQUEST',
      sets: 0,
    });
    expect(options.find((o) => o.slotId === 'pull')).toMatchObject({
      available: true,
      reason: null,
      sets: 2,
    });
    const base = extraInput();
    const { core: _, ...selections } = base.block.selections;
    const noCore = dayOptions({ ...base, block: { ...base.block, selections } });
    expect(noCore.find((o) => o.slotId === 'core')).toEqual({
      slotId: 'core',
      exerciseId: null,
      available: false,
      reason: 'NO_CANDIDATE',
      sets: 0,
    });
  });
});

describe('a composed day in the week', () => {
  const week = (patch: Partial<WeekInput> = {}): WeekInput => {
    const { asOf: _, ...day } = extraInput();
    return { ...day, from: DATE, days: 3, lastSessionDate: null, ...patch };
  };

  it('trains what was composed, says so, and leaves other days to the engine', () => {
    const plan = planWeek(week({ constraints: [compose([{ slotId: 'pull', sets: 1 }])] }));
    const [first, second] = plan.days;
    expect(first!.composed).toBe(true);
    expect(first!.selection!.items.map((i) => [i.slotId, i.sets])).toEqual([['pull', 1]]);
    expect(first!.forecast!.exercises.map((e) => e.exerciseId)).toEqual(['pull']);
    expect(second!.composed).toBe(false);
    expect(first!.options).toBeUndefined();
  });

  it('drops what no longer holds, and gives the day back when nothing does', () => {
    const partly = planWeek(
      week({
        constraints: [
          compose([
            { slotId: 'push', sets: 2 },
            { slotId: 'pull', sets: 2 },
          ]),
          sorePush,
        ],
      }),
    ).days[0]!;
    expect(partly.selection!.items.map((i) => i.slotId)).toEqual(['pull']);
    expect(partly.violations).toEqual([{ slotId: 'push', code: 'AVOIDED_BY_REQUEST' }]);

    const none = planWeek(week({ constraints: [compose([{ slotId: 'push', sets: 2 }]), sorePush] }))
      .days[0]!;
    expect(none.composed).toBe(false);
    expect(none.selection!.items.length).toBeGreaterThan(0);
    expect(none.selection!.items.some((i) => i.slotId === 'push')).toBe(false);
    expect(none.violations).toEqual([{ slotId: 'push', code: 'AVOIDED_BY_REQUEST' }]);
  });

  it('rests on a rest day whatever was composed', () => {
    const rest: PlanConstraint = { ...compose([]), id: 'rest', kind: 'rest_day', reason: 'busy' };
    const day = planWeek(week({ constraints: [compose([{ slotId: 'pull', sets: 2 }]), rest] }))
      .days[0]!;
    expect(day).toMatchObject({ rest: true, composed: false, selection: null });
  });

  it('lists the options of the one day asked for', () => {
    const plan = planWeek(week({ optionsFor: '2026-10-09' }));
    expect(plan.days[0]!.options).toBeUndefined();
    expect(plan.days[1]!.options!.map((o) => o.slotId)).toEqual(['legs', 'push', 'pull', 'core']);
  });
});
