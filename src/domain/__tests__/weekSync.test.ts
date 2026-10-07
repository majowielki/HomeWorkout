import exercisesJson from '@data/exercises.json';
import slotsJson from '@data/slots.json';
import { slotCatalogueSchema } from '@data/slots.schema';

import type { PlanConstraint } from '../plan/constraints';
import { simulate } from '../plan/simulate';
import type { SessionPlan } from '../plan/types';
import { type StoredDay, type SyncInput, syncWeek } from '../plan/weekSync';
import type { HistorySession } from '../progression/history';
import { addDays } from '../time/trainingDate';
import type { Exercise } from '../types';
import { HARD_ONLY } from './fixtures';

const exercises = (exercisesJson as { exercises: Exercise[] }).exercises;
const catalog = Object.fromEntries(exercises.map((e) => [e.id, e]));
const { slots } = slotCatalogueSchema.parse(slotsJson);
const eligibility = { profile: HARD_ONLY, excludedIds: new Set<string>() };
const MONDAY = '2026-10-05';
const BLOCK = simulate({ start: MONDAY, days: 1, catalog, slots, eligibility })[0]!.block;

const input = (patch: Partial<SyncInput> = {}): SyncInput => ({
  asOf: MONDAY,
  stored: [],
  trainedDates: new Set(),
  catalog,
  slots,
  eligibility,
  block: BLOCK,
  sessions: [],
  lastSessionDate: null,
  rides: [],
  daily: [],
  ...patch,
});

const asDone = (plan: SessionPlan, date: string): HistorySession => ({
  date,
  sets: plan.exercises.map((e) => ({
    exerciseId: e.exerciseId,
    isWarmup: false,
    reps: e.unit === 'reps' ? e.target : null,
    timeSec: e.unit === 'sec' ? e.target : null,
    rir: e.targetRirMin,
    load: e.load,
  })),
});

describe('syncWeek', () => {
  const first = syncWeek(input());
  const stored: StoredDay[] = first.rows;

  it('plans seven days from today the first time, as new days', () => {
    expect(first.from).toBe(MONDAY);
    expect(first.rows.map((r) => r.date)).toEqual(
      Array.from({ length: 7 }, (_, i) => addDays(MONDAY, i)),
    );
    expect(first.trigger).toBe('horizon');
    expect(first.changes).toEqual([]);
    expect(first.statusUpdates).toEqual([]);
  });

  it('changes nothing when nothing happened', () => {
    const again = syncWeek(input({ stored }));
    expect(again.trigger).toBeNull();
    expect(again.rows.map((r) => r.selection)).toEqual(stored.map((r) => r.selection));
  });

  it('moves on a day after training: yesterday done, one more day at the end', () => {
    const next = syncWeek(
      input({
        asOf: addDays(MONDAY, 1),
        stored,
        trainedDates: new Set([MONDAY]),
        sessions: [asDone(stored[0]!.forecast!, MONDAY)],
        lastSessionDate: MONDAY,
      }),
    );
    expect(next.statusUpdates).toEqual([{ date: MONDAY, status: 'done' }]);
    expect(next.trigger).toBe('horizon');
    expect(next.rows.at(-1)!.date).toBe(addDays(MONDAY, 7));
    expect(next.rows.slice(0, 6).map((r) => r.selection)).toEqual(
      stored.slice(1).map((r) => r.selection),
    );
  });

  it('plans the rest of the week again after a missed day', () => {
    const next = syncWeek(input({ asOf: addDays(MONDAY, 1), stored }));
    expect(next.statusUpdates).toEqual([{ date: MONDAY, status: 'missed' }]);
    expect(next.trigger).toBe('missed_day');
    expect(next.rows[0]!.date).toBe(addDays(MONDAY, 1));
  });

  it('closes a trained today and plans from tomorrow', () => {
    const done = syncWeek(
      input({
        stored,
        trainedDates: new Set([MONDAY]),
        sessions: [asDone(stored[0]!.forecast!, MONDAY)],
        lastSessionDate: MONDAY,
      }),
    );
    expect(done.from).toBe(addDays(MONDAY, 1));
    expect(done.statusUpdates).toEqual([{ date: MONDAY, status: 'done' }]);
    expect(done.rows).toHaveLength(6);
  });

  it('marks a past rest day done and leaves past days already marked alone', () => {
    const past: StoredDay[] = [
      { date: addDays(MONDAY, -2), selection: null, forecast: null, status: 'planned' },
      {
        date: addDays(MONDAY, -1),
        selection: stored[0]!.selection,
        forecast: null,
        status: 'done',
      },
    ];
    const next = syncWeek(input({ stored: [...past, ...stored] }));
    expect(next.statusUpdates).toEqual([{ date: addDays(MONDAY, -2), status: 'done' }]);
    expect(next.trigger).toBeNull();
  });

  it('says which days a request changed, and why', () => {
    const rest: PlanConstraint = {
      id: 'r',
      kind: 'rest_day',
      muscles: [],
      from: addDays(MONDAY, 2),
      until: addDays(MONDAY, 2),
      reason: 'busy',
      source: 'user',
      note: null,
    };
    const next = syncWeek(input({ stored, constraints: [rest] }));
    expect(next.trigger).toBe('unsafe');
    const wednesday = next.changes.find((c) => c.date === addDays(MONDAY, 2))!;
    expect(wednesday).toMatchObject({ after: null, reasons: ['REST_DAY'] });
    expect(wednesday.before).toEqual(stored[2]!.forecast!.regions);

    // Taken back: the rest day trains again.
    const back = syncWeek(input({ stored: next.rows }));
    expect(back.changes.find((c) => c.date === addDays(MONDAY, 2))).toMatchObject({
      before: null,
      reasons: [],
    });

    const asked = syncWeek(
      input({ stored, constraints: [rest], request: { trigger: 'constraint', from: rest.from } }),
    );
    expect(asked.trigger).toBe('constraint');
    // Days before the request are kept as they were.
    expect(asked.rows.slice(0, 2).map((r) => r.selection)).toEqual(
      stored.slice(0, 2).map((r) => r.selection),
    );
  });

  it('plans everything again on "Przelicz tydzień", never before today', () => {
    const manual = syncWeek(
      input({ stored, request: { trigger: 'manual', from: addDays(MONDAY, -3) } }),
    );
    expect(manual.trigger).toBe('manual');
    expect(manual.from).toBe(MONDAY);
    const plain = syncWeek(input({ stored, request: { trigger: 'coach' } }));
    expect(plain.trigger).toBe('coach');
  });

  it('reaches as far as asked', () => {
    expect(syncWeek(input({ horizonDays: 3 })).rows).toHaveLength(3);
    expect(syncWeek(input({ horizonDays: 0 })).rows).toEqual([]);
  });
});
