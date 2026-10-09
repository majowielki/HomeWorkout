import { defaultPreferences } from '../preferences/preferences';
import type { PlanConstraint } from '../plan/constraints';
import { planDay, selectionOf } from '../plan/day';
import {
  completedAsPlanned,
  planWeek,
  recordsBefore,
  sameSelection,
  summaryOf,
  syncWeek,
  type SyncInput,
  type WeekInput,
} from '../plan/week';
import { FOLLOWS_THE_PLAN, recordsOf } from '../plan/simulate';
import type { ExposureRecord } from '../observations/exposure';
import { CATALOG, ELIGIBILITY, SELECTIONS, SLOTS } from './dayFixtures';
import { VERSIONS } from './compileFixtures';
import { HASH_A } from './planFixtures';

const FROM = '2026-10-05';
const block = {
  index: 1,
  startedOn: FROM,
  deloadFrom: null,
  deloadReason: null,
  selections: SELECTIONS,
};
const week = (patch: Partial<WeekInput> = {}): WeekInput => ({
  from: FROM,
  days: 7,
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
const sync = (patch: Partial<SyncInput> = {}): SyncInput => {
  const { from: _from, days: _days, ...rest } = week();
  return { ...rest, asOf: FROM, stored: [], trainedDates: new Set(), ...patch };
};
const constraint = (patch: Partial<PlanConstraint>): PlanConstraint => ({
  id: 'c1',
  kind: 'rest_day',
  muscles: [],
  from: FROM,
  until: FROM,
  reason: 'busy',
  source: 'user',
  note: null,
  ...patch,
});
describe('P5.1: the week of the engine', () => {
  it('plans every day from the history plus the days before it, as a forecast', () => {
    const plan = planWeek(week());
    expect(plan.days).toHaveLength(7);
    expect(plan.days.map((d) => d.date)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);
    for (const day of plan.days) {
      expect(day.status).toBe('new');
      expect(day.forecast?.sessionId).toBe(`forecast-${day.date}`);
      expect(day.forecast).not.toBeNull();
    }
    expect(plan.days[0]!.selection!.length).toBeGreaterThan(0);
    expect(plan.advances).toHaveLength(7);
    for (const m of Object.values(plan.volume)) expect(m).toBeLessThanOrEqual(12);
  });

  it('T21 the forecast never reaches the history: the input is untouched and the first day sees only what was done', () => {
    const input = week();
    const before = JSON.stringify(input);
    const plan = planWeek(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(plan)).not.toContain('"observation"');
    const alone = planDay({
      asOf: FROM,
      catalog: CATALOG,
      slots: SLOTS,
      eligibility: ELIGIBILITY,
      block,
      records: [],
      rides: [],
      daily: [],
      preferences: defaultPreferences(),
      session: {
        sessionId: 'forecast-2026-10-05',
        planRevision: 1,
        kind: 'main',
        versions: VERSIONS,
        snapshotFingerprint: HASH_A,
        inputFingerprint: HASH_A,
      },
    });
    expect(plan.days[0]!.selection).toEqual(alone.selection);
    expect(plan.days[0]!.output!.result).toMatchObject({ kind: alone.result.kind });
  });

  it('a better forecast athlete changes the later days, never the first nor the real history', () => {
    const generous = planWeek(
      week({
        athlete: { amount: (s) => (s.target.kind === 'reps' ? s.target.max : 30), rir: () => 3 },
      }),
    );
    const plain = planWeek(week());
    expect(generous.days[0]!.selection).toEqual(plain.days[0]!.selection);
    expect(
      generous.days[0]!.forecast!.exposures.map((e) => e.sets.map((s) => s.resistance)),
    ).toEqual(plain.days[0]!.forecast!.exposures.map((e) => e.sets.map((s) => s.resistance)));
  });

  it('a rest day from the weekly pattern or a request has no plan, and says so for a stored day', () => {
    const plan = planWeek(
      week({
        week: { restWeekdays: [1] },
        constraints: [constraint({ from: '2026-10-08', until: '2026-10-08' })],
        kept: { '2026-10-08': [{ slotId: 'x', exerciseId: 'y', sets: 1 }] },
      }),
    );
    const rest = plan.days.filter((d) => d.rest).map((d) => d.date);
    expect(rest).toEqual(
      ['2026-10-06', '2026-10-08', '2026-10-13'].filter((d) => d <= '2026-10-11'),
    );
    const asked = plan.days.find((d) => d.date === '2026-10-08')!;
    expect(asked).toMatchObject({ selection: null, forecast: null, status: 'changed' });
    expect(asked.violations).toEqual([{ slotId: '', reason: 'REST_DAY' }]);
    expect(plan.days.find((d) => d.date === '2026-10-06')).toMatchObject({
      status: 'new',
      violations: [],
    });
  });

  it('a day chosen earlier stays while it holds, and the whole week is firm', () => {
    const first = planWeek(week());
    const kept = Object.fromEntries(first.days.map((d) => [d.date, d.selection!]));
    const again = planWeek(week({ kept }));
    for (const [i, day] of again.days.entries()) {
      expect(day.status).toBe('kept');
      expect(day.output!.kept).toBe('held');
      expect(day.selection).toEqual(first.days[i]!.selection);
    }
  });

  it('a day that no longer holds is chosen anew, with the reason', () => {
    const first = planWeek(week({ days: 1 }));
    const item = first.days[0]!.selection![0]!;
    // The exercise of the slot is not the one kept (the block rotated).
    const rotated = planWeek(
      week({ days: 1, kept: { [FROM]: [{ ...item, exerciseId: 'not-the-one' }] } }),
    );
    expect(rotated.days[0]!.status).toBe('changed');
    expect(rotated.days[0]!.violations).toEqual([
      { slotId: item.slotId, reason: expect.any(String) },
    ]);
    // More sets than the day can take.
    const greedy = planWeek(week({ days: 1, kept: { [FROM]: [{ ...item, sets: 9 }] } }));
    expect(greedy.days[0]!.status).toBe('changed');
    // A muscle asked to be left out.
    const muscle = CATALOG[item.exerciseId]!.primaryMuscles[0]!;
    const avoided = planWeek(
      week({
        days: 1,
        kept: { [FROM]: first.days[0]!.selection! },
        constraints: [constraint({ kind: 'avoid_muscle', muscles: [muscle], reason: 'doms' })],
      }),
    );
    expect(avoided.days[0]!.status).toBe('changed');
    expect(avoided.days[0]!.violations.map((v) => v.slotId)).toContain(item.slotId);
    expect(avoided.days[0]!.violations.map((v) => v.reason)).toContain('AVOIDED_BY_REQUEST');
    for (const k of avoided.days[0]!.selection!)
      expect(CATALOG[k.exerciseId]!.primaryMuscles).not.toContain(muscle);
  });

  it('a composed day takes the movements asked for, and says what it could not', () => {
    const items = [
      { slotId: SLOTS.find((s) => s.kind === 'compound')!.id, sets: 2 },
      { slotId: 'no-such-slot', sets: 1 },
    ];
    const plan = planWeek(
      week({ days: 1, constraints: [constraint({ kind: 'compose_day', items, reason: 'other' })] }),
    );
    const day = plan.days[0]!;
    expect(day.composed).toBe(true);
    expect(day.selection!.map((s) => s.slotId)).toEqual([items[0]!.slotId]);
    expect(day.violations).toEqual([{ slotId: 'no-such-slot', reason: 'NOT_PICKED' }]);
    expect(day.status).toBe('new');
    // Stored earlier as composed: the same composition is `kept`, another is `changed`.
    const again = planWeek(
      week({
        days: 1,
        constraints: [constraint({ kind: 'compose_day', items, reason: 'other' })],
        kept: { [FROM]: day.selection! },
      }),
    );
    expect(again.days[0]!.status).toBe('kept');
    const other = planWeek(
      week({
        days: 1,
        constraints: [constraint({ kind: 'compose_day', items, reason: 'other' })],
        kept: { [FROM]: [{ ...day.selection![0]!, sets: 1 }] },
      }),
    );
    expect(other.days[0]!.status).toBe('changed');
  });

  it('T19 what is left of a running session counts as done in the days after it', () => {
    const today = planDay({
      asOf: FROM,
      catalog: CATALOG,
      slots: SLOTS,
      eligibility: ELIGIBILITY,
      block,
      records: [],
      rides: [],
      daily: [],
      preferences: defaultPreferences(),
      session: {
        sessionId: 'live',
        planRevision: 1,
        kind: 'main',
        versions: VERSIONS,
        snapshotFingerprint: HASH_A,
        inputFingerprint: HASH_A,
      },
    });
    const running =
      today.result.kind === 'ready' || today.result.kind === 'adjusted' ? today.result.plan : null;
    expect(running).not.toBeNull();
    const pending: ExposureRecord[] = recordsOf(running!, FOLLOWS_THE_PLAN).map((r) => ({
      ...r,
      sets: r.sets.map((s) => ({ ...s, disposition: 'pending' as const, observation: null })),
    }));
    const done = completedAsPlanned(pending, running!);
    expect(done.every((r) => r.sets.every((s) => s.disposition === 'performed'))).toBe(true);
    expect(pending.every((r) => r.sets.every((s) => s.disposition === 'pending'))).toBe(true);
    const without = planWeek(week({ from: '2026-10-06', days: 1, records: pending }));
    const reserved = planWeek(week({ from: '2026-10-06', days: 1, records: pending, running }));
    expect(reserved.days[0]!.selection).not.toEqual(without.days[0]!.selection);
    // Records of another session are left as they were.
    const other = completedAsPlanned(
      pending.map((r) => ({ ...r, sessionId: 'someone-else' })),
      running!,
    );
    expect(other.every((r) => r.sets.every((s) => s.disposition === 'pending'))).toBe(true);
  });

  it('a day nothing can be planned for has no forecast and no projection after it', () => {
    const plan = planWeek(
      week({
        days: 2,
        constraints: [
          constraint({
            kind: 'compose_day',
            items: [{ slotId: 'no-such-slot', sets: 1 }],
            reason: 'other',
            until: '2026-10-05',
          }),
        ],
      }),
    );
    expect(plan.days[0]).toMatchObject({ forecast: null, selection: [], composed: true });
    expect(plan.days[0]!.output!.result.kind).not.toBe('ready');
    expect(plan.days[1]!.forecast).not.toBeNull();
  });

  it('says why a movement of a composed day was not taken when the slot was skipped', () => {
    const slot = SLOTS.find((s) => s.kind === 'compound')!;
    const exercise = CATALOG[SELECTIONS[slot.id]!]!;
    const plan = planWeek(
      week({
        days: 1,
        constraints: [
          constraint({
            kind: 'avoid_muscle',
            muscles: [exercise.primaryMuscles[0]!],
            reason: 'doms',
          }),
          constraint({
            id: 'c2',
            kind: 'compose_day',
            items: [{ slotId: slot.id, sets: 2 }],
            reason: 'other',
          }),
        ],
      }),
    );
    expect(plan.days[0]!.violations).toEqual([{ slotId: slot.id, reason: 'AVOIDED_BY_REQUEST' }]);
  });

  it('a block that ends inside the week rotates, and the ended blocks count for the next choice', () => {
    const old = { ...block, startedOn: '2026-08-01' };
    const plan = planWeek(week({ block: old, endedBlocks: [{ ...old, index: 0 }], days: 2 }));
    expect(plan.advances[0]!.closed).not.toBeNull();
    expect(plan.days[0]!.block.index).toBe(2);
    expect(plan.days[1]!.block.index).toBe(2);
  });

  it('a running session with some sets already done keeps those as they were', () => {
    const live = planWeek(week({ days: 1 })).days[0]!.forecast!;
    const records = recordsOf(live, FOLLOWS_THE_PLAN).map((r, i) => ({
      ...r,
      sets: r.sets.map((s, j) =>
        i === 0 && j === 0 ? s : { ...s, disposition: 'pending' as const, observation: null },
      ),
    }));
    const done = completedAsPlanned(records, live);
    expect(done[0]!.sets[0]).toEqual(records[0]!.sets[0]);
    expect(done[0]!.sets.slice(1).every((s) => s.disposition === 'performed')).toBe(true);
  });

  it('keeps what a day was planned for, with or without the block it belonged to', () => {
    const plan = planWeek(week({ days: 1 })).days[0]!;
    const named = summaryOf(plan.output!, plan.forecast, false, 3);
    expect(named).toMatchObject({ blockIndex: 3, phase: 'work', composed: false });
    expect(named.bike!.minutes).toBeGreaterThan(0);
    expect(named.estimatedMinutes).toBeGreaterThan(0);
    const bare = summaryOf(plan.output!, null, true);
    expect(bare).toMatchObject({ composed: true, estimatedMinutes: 0 });
    expect(bare).not.toHaveProperty('blockIndex');
    expect(plan.summary).toMatchObject({ blockIndex: 1 });
  });

  it('keeps the selection helpers honest', () => {
    expect(sameSelection(null, null)).toBe(true);
    expect(sameSelection(null, [])).toBe(false);
    expect(sameSelection([], null)).toBe(false);
    const a = [{ slotId: 'a', exerciseId: 'b', sets: 2 }];
    expect(sameSelection(a, [{ ...a[0]! }])).toBe(true);
    expect(sameSelection(a, [{ ...a[0]!, sets: 3 }])).toBe(false);
    const plan = planWeek(week({ days: 1 }));
    expect(selectionOf(plan.days[0]!.forecast!)).toEqual(plan.days[0]!.selection);
  });
});

/** The first `n` days of a synced week, done exactly as planned. */
const didFirst = (first: ReturnType<typeof syncWeek>, n: number): ExposureRecord[] =>
  first.week.days
    .slice(0, n)
    .flatMap((d) => (d.forecast ? recordsOf(d.forecast, FOLLOWS_THE_PLAN) : []));

describe('P5.1: bringing the stored week up to date', () => {
  it('plans a week that was never stored, and then leaves it alone', () => {
    const first = syncWeek(sync());
    expect(first.from).toBe(FROM);
    expect(first.rows).toHaveLength(7);
    expect(first.trigger).toBe('horizon');
    expect(first.changes).toEqual([]);
    expect(first.rows.every((r) => r.status === 'planned')).toBe(true);
    const second = syncWeek(sync({ stored: first.rows }));
    expect(second.trigger).toBeNull();
    expect(second.changes).toEqual([]);
    expect(second.week.days.every((d) => d.status === 'kept')).toBe(true);
  });

  it('the horizon moves with the days: one new day at the end', () => {
    const first = syncWeek(sync());
    const next = syncWeek(
      sync({
        asOf: '2026-10-06',
        stored: first.rows,
        trainedDates: new Set([FROM]),
        records: didFirst(first, 1),
      }),
    );
    expect(next.from).toBe('2026-10-06');
    expect(next.rows).toHaveLength(7);
    expect(next.trigger).toBe('horizon');
    expect(next.week.days.slice(0, 6).every((d) => d.status === 'kept')).toBe(true);
    expect(next.week.days[6]!.status).toBe('new');
  });

  it('a planned day that went by is marked done or missed, and a miss plans again from today', () => {
    const first = syncWeek(sync());
    const trained = syncWeek(
      sync({
        asOf: '2026-10-06',
        stored: first.rows,
        trainedDates: new Set([FROM]),
        records: didFirst(first, 1),
      }),
    );
    expect(trained.statusUpdates).toEqual([{ date: FROM, status: 'done' }]);
    expect(trained.trigger).toBe('horizon');
    const missed = syncWeek(sync({ asOf: '2026-10-06', stored: first.rows }));
    expect(missed.statusUpdates).toEqual([{ date: FROM, status: 'missed' }]);
    expect(missed.trigger).toBe('missed_day');
    expect(missed.week.days.every((d) => d.status === 'new')).toBe(true);
    const rest = syncWeek(
      sync({
        asOf: '2026-10-06',
        stored: [{ date: FROM, selection: null, forecast: null, status: 'planned' }],
      }),
    );
    expect(rest.statusUpdates).toEqual([{ date: FROM, status: 'done' }]);
  });

  it('days already marked done or missed are left as they are', () => {
    const first = syncWeek(sync());
    const marked = first.rows.map((r, i) => ({
      ...r,
      status: i === 0 ? ('done' as const) : ('missed' as const),
    }));
    const result = syncWeek(sync({ asOf: '2026-10-07', stored: marked }));
    expect(result.statusUpdates).toEqual([]);
    expect(result.trigger).not.toBe('missed_day');
  });

  it('a day that already has a session starts the plan at tomorrow, finished or under way', () => {
    const first = syncWeek(sync());
    const done = syncWeek(
      sync({ stored: first.rows, trainedDates: new Set([FROM]), records: didFirst(first, 1) }),
    );
    expect(done.from).toBe('2026-10-06');
    expect(done.statusUpdates).toEqual([{ date: FROM, status: 'done' }]);
    expect(done.rows).toHaveLength(6);
    const live = planWeek(week({ days: 1 })).days[0]!.forecast!;
    const running = syncWeek(sync({ stored: first.rows, running: live }));
    expect(running.from).toBe('2026-10-06');
    expect(running.statusUpdates).toEqual([]);
  });

  it('a deload that begins inside the stored week gives its days fewer sets and says the block changed (ENG-02)', () => {
    const first = syncWeek(sync());
    const deload = syncWeek(sync({ stored: first.rows, deloadRequests: new Set(['2026-10-07']) }));
    expect(deload.trigger).toBe('block');
    const setsOn = (r: typeof first, date: string) =>
      r.rows.find((d) => d.date === date)!.selection!.reduce((sum, k) => sum + k.sets, 0);
    expect(setsOn(deload, '2026-10-07')).toBeLessThan(setsOn(first, '2026-10-07'));
    expect(setsOn(deload, '2026-10-06')).toBe(setsOn(first, '2026-10-06'));
  });

  it('what a day is planned after: the history and the training days before it, done as planned', () => {
    const plan = planWeek(week({ days: 4, week: { restWeekdays: [1] } }));
    expect(plan.days[1]!.rest).toBe(true);
    const after = recordsBefore(plan, '2026-10-08', []);
    const dates = new Set(after.map((r) => r.trainingDate));
    expect(dates).toEqual(new Set(['2026-10-05', '2026-10-07']));
    expect(recordsBefore(plan, FROM, [])).toEqual([]);
  });

  it('a session begun yesterday and still under way is not a missed day (Q-04)', () => {
    const first = syncWeek(sync());
    const live = planWeek(week({ days: 1 })).days[0]!.forecast!;
    const result = syncWeek(sync({ asOf: '2026-10-06', stored: first.rows, running: live }));
    expect(result.statusUpdates).toEqual([]);
    expect(result.trigger).not.toBe('missed_day');
    expect(result.from).toBe('2026-10-07');
  });

  it('an explicit request plans from scratch from the day asked, keeping the days before it', () => {
    const first = syncWeek(sync());
    const manual = syncWeek(sync({ stored: first.rows, request: { trigger: 'manual' } }));
    expect(manual.trigger).toBe('manual');
    expect(manual.week.days.every((d) => d.status === 'new')).toBe(true);
    const later = syncWeek(
      sync({ stored: first.rows, request: { trigger: 'coach', from: '2026-10-08' } }),
    );
    expect(later.trigger).toBe('coach');
    expect(later.week.days.map((d) => d.status)).toEqual([
      'kept',
      'kept',
      'kept',
      'new',
      'new',
      'new',
      'new',
    ]);
    const past = syncWeek(
      sync({ stored: first.rows, request: { trigger: 'constraint', from: '2026-10-01' } }),
    );
    expect(past.week.days.every((d) => d.status === 'new')).toBe(true);
  });

  it('reports a stored day that no longer holds, with the regions before and after and the reason', () => {
    const first = syncWeek(sync());
    const day = first.rows[2]!;
    const muscle = CATALOG[day.selection![0]!.exerciseId]!.primaryMuscles[0]!;
    const changed = syncWeek(
      sync({
        stored: first.rows,
        constraints: [
          constraint({
            kind: 'avoid_muscle',
            muscles: [muscle],
            reason: 'doms',
            from: day.date,
            until: day.date,
          }),
        ],
      }),
    );
    expect(changed.trigger).toBe('unsafe');
    const change = changed.changes.find((c) => c.date === day.date)!;
    expect(change.reasons).toContain('AVOIDED_BY_REQUEST');
    expect(change.before!.length).toBeGreaterThan(0);
    expect(change.after).not.toBeNull();
    const restDay = syncWeek(
      sync({
        stored: first.rows,
        constraints: [constraint({ from: day.date, until: day.date })],
      }),
    );
    expect(restDay.changes.find((c) => c.date === day.date)).toMatchObject({
      after: null,
      reasons: ['REST_DAY'],
    });
    // A day stored with no forecast has no regions before.
    const bare = syncWeek(
      sync({
        stored: [
          {
            date: FROM,
            selection: [{ slotId: 'x', exerciseId: 'y', sets: 1 }],
            forecast: null,
            status: 'planned',
          },
        ],
      }),
    );
    expect(bare.changes[0]).toMatchObject({ date: FROM, before: null });
  });

  it('plans fewer days when the horizon is shorter', () => {
    expect(syncWeek(sync({ horizonDays: 3 })).rows).toHaveLength(3);
    expect(syncWeek(sync({ horizonDays: 0 })).rows).toHaveLength(0);
  });
});
