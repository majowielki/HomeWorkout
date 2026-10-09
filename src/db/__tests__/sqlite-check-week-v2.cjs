/* P5.1: the week of engine v2 on real SQLite: the choice of every day is stored without a
 * load, a look that changes nothing writes nothing, the days follow the sessions that are
 * done, and a change of the person's own requests shows up as a banner. */
const { assert, current, all, exec, seeded, failInsert } = require('./sqlite-harness.cjs');
const week = require('../repositories/weekPlanV2.ts');
const { addConstraint } = require('../repositories/weekPlan.ts');
const { previewDay, acceptDay } = require('../repositories/planningV2.ts');
const backup = require('../repositories/backup.ts');
const { doTheSession } = require('./sqlite-day-helpers.cjs');

const at = (day, hour = 9) => new Date(2026, 9, day, hour, 0, 0);
const NOW = at(5);
const TABLES = ['planned_days_v2', 'plan_generations_v2', 'workouts', 'training_blocks'];
const snapshot = () => Object.fromEntries(TABLES.map((t) => [t, all(`SELECT * FROM ${t}`)]));
const days = () => all('SELECT * FROM planned_days_v2 ORDER BY date');

/** Plans, starts and finishes the day of `day`, as planned. */
function trainOn(day) {
  const request = { sessionId: `day-${day}` };
  const shown = previewDay(request, at(day));
  const plan = shown.output.result.plan;
  const accepted = acceptDay(
    {
      commandId: `accept-${day}`,
      request,
      expectedPlanHash: shown.planHash,
      timeZone: null,
    },
    at(day, 10),
  );
  assert.equal(accepted.kind, 'committed', JSON.stringify(accepted));
  doTheSession(plan, at(day, 11));
}

const CASES = [
  [
    'a week that was never stored is planned and stored: the choice of each day, no load',
    async () => {
      await seeded();
      const { result, asOf } = week.syncWeek({}, NOW);
      assert.equal(asOf, '2026-10-05');
      assert.equal(result.trigger, 'horizon');
      const rows = days();
      assert.equal(rows.length, 7);
      assert.deepEqual(
        rows.map((r) => r.date),
        ['05', '06', '07', '08', '09', '10', '11'].map((d) => `2026-10-${d}`),
      );
      assert.ok(rows.every((r) => r.status === 'planned'));
      const first = JSON.parse(rows[0].selection);
      assert.ok(first.length > 0);
      for (const item of first)
        assert.deepEqual(Object.keys(item).sort(), ['exerciseId', 'sets', 'slotId']);
      assert.equal(JSON.parse(rows[0].forecast).sessionId, 'forecast-2026-10-05');
      const [generation] = all('SELECT * FROM plan_generations_v2');
      assert.equal(generation.trigger, 'horizon');
      assert.notEqual(generation.seen_at, null, 'a week with no changes is born seen');
      assert.equal(week.getUnseenChanges(), null);
    },
  ],
  [
    'a look that changes nothing leaves the choice and the generation alone',
    async () => {
      await seeded();
      week.syncWeek({}, NOW);
      const before = all(
        'SELECT date, selection, generation_id FROM planned_days_v2 ORDER BY date',
      );
      const generations = all('SELECT * FROM plan_generations_v2').length;
      const again = week.syncWeek({}, at(5, 12));
      assert.equal(again.result.trigger, null);
      assert.deepEqual(
        all('SELECT date, selection, generation_id FROM planned_days_v2 ORDER BY date'),
        before,
      );
      assert.equal(all('SELECT * FROM plan_generations_v2').length, generations);
    },
  ],
  [
    'the preview writes nothing and the week read back is what was stored',
    async () => {
      await seeded();
      const before = snapshot();
      const shown = week.previewWeek({}, NOW);
      assert.equal(shown.result.rows.length, 7);
      assert.deepEqual(snapshot(), before);
      week.syncWeek({}, NOW);
      const read = week.getWeek('2026-10-05', '2026-10-11');
      assert.equal(read.length, 7);
      assert.deepEqual(
        read.map((d) => d.selection),
        shown.result.rows.map((d) => d.selection),
      );
      assert.equal(week.getWeek('2026-10-08', '2026-10-09').length, 2);
    },
  ],
  [
    'a day that was trained is done, and the week goes on from tomorrow with one new day',
    async () => {
      await seeded();
      week.syncWeek({}, NOW);
      trainOn(5);
      const next = week.syncWeek({}, at(6));
      assert.equal(next.result.from, '2026-10-06');
      assert.deepEqual(next.result.statusUpdates, [{ date: '2026-10-05', status: 'done' }]);
      const rows = days();
      assert.equal(rows[0].status, 'done');
      assert.equal(rows.length, 8);
      assert.equal(rows.at(-1).date, '2026-10-12');
    },
  ],
  [
    'a session under way takes today: the week is planned from tomorrow',
    async () => {
      await seeded();
      const request = { sessionId: 'live' };
      const shown = previewDay(request, NOW);
      assert.equal(
        acceptDay(
          { commandId: 'a', request, expectedPlanHash: shown.planHash, timeZone: null },
          at(5, 10),
        ).kind,
        'committed',
      );
      const { result } = week.syncWeek({}, at(5, 11));
      assert.equal(result.from, '2026-10-06');
      assert.equal(days().length, 6);
      assert.equal(days()[0].date, '2026-10-06');
    },
  ],
  [
    'a day that went by untrained is missed and the week is planned again from today',
    async () => {
      await seeded();
      week.syncWeek({}, NOW);
      const { result } = week.syncWeek({}, at(7));
      assert.deepEqual(
        result.statusUpdates.map((u) => [u.date, u.status]),
        [
          ['2026-10-05', 'missed'],
          ['2026-10-06', 'missed'],
        ],
      );
      assert.equal(result.trigger, 'missed_day');
      assert.equal(days().find((d) => d.date === '2026-10-05').status, 'missed');
      assert.equal(days().find((d) => d.date === '2026-10-07').status, 'planned');
    },
  ],
  [
    'a new request changes the days it touches, and the change waits as a banner until it is closed',
    async () => {
      await seeded();
      week.syncWeek({}, NOW);
      await addConstraint({
        kind: 'rest_day',
        muscles: [],
        from: '2026-10-07',
        until: '2026-10-07',
        reason: 'busy',
        source: 'user',
        note: null,
      });
      const { result } = week.syncWeek({}, at(5, 12));
      assert.equal(result.trigger, 'unsafe');
      const banner = week.getUnseenChanges();
      assert.equal(banner.trigger, 'unsafe');
      // The freed day also lets the empty days at the end of the week take real work.
      assert.deepEqual(
        banner.changes.map((c) => c.date),
        ['2026-10-07', '2026-10-10', '2026-10-11'],
      );
      assert.deepEqual(banner.changes[0].reasons, ['REST_DAY']);
      assert.equal(banner.changes[0].after, null);
      assert.deepEqual(banner.changes[1].before, []);
      assert.equal(days().find((d) => d.date === '2026-10-07').selection, null);
      week.markChangesSeen(banner.id, at(5, 13));
      assert.equal(week.getUnseenChanges(), null);
      week.markChangesSeen('no-such-generation', at(5, 14));
    },
  ],
  [
    'an explicit request plans the days again and says why',
    async () => {
      await seeded();
      week.syncWeek({}, NOW);
      const { result } = week.syncWeek({ request: { trigger: 'manual' } }, at(5, 12));
      assert.equal(result.trigger, 'manual');
      assert.equal(all('SELECT * FROM plan_generations_v2').length, 2);
      assert.ok(
        days().every(
          (d) =>
            d.generation_id ===
            all('SELECT id FROM plan_generations_v2 ORDER BY created_at DESC')[0].id,
        ),
      );
      assert.equal(week.syncWeek({ horizonDays: 3 }, at(5, 13)).result.rows.length, 3);
    },
  ],
  [
    'a failure while writing takes the whole week back with it',
    async () => {
      await seeded();
      const undo = failInsert('no_week', 'planned_days_v2');
      const before = snapshot();
      assert.throws(() => week.syncWeek({}, NOW), /no_week/);
      undo();
      assert.deepEqual(snapshot(), before);
      assert.equal(week.syncWeek({}, NOW).result.rows.length, 7);
    },
  ],
  [
    'restoring a backup plans the week again: the stored week and the answers follow the history that was replaced',
    async () => {
      await seeded();
      const saved = await backup.dumpAll(NOW);
      week.syncWeek({}, NOW);
      exec(
        "INSERT INTO prescription_answers (comparison_key, kind, answer, after_exposure_id, answered_on, command_id, answered_at) VALUES ('k', 'step_up', 'yes', 'e', '2026-10-05', 'c', '2026-10-05T08:00:00Z')",
      );
      assert.equal(all('SELECT * FROM planned_days_v2').length, 7);
      await backup.restoreAll(saved);
      assert.equal(all('SELECT * FROM planned_days_v2').length, 0);
      assert.equal(all('SELECT * FROM plan_generations_v2').length, 0);
      assert.equal(all('SELECT * FROM prescription_answers').length, 0);
      assert.equal(week.syncWeek({}, NOW).result.rows.length, 7);
    },
  ],
  [
    'the week of engine 1 is not touched',
    async () => {
      await seeded();
      exec(
        "INSERT INTO planned_days (date, seq, status, generation_id, updated_at) VALUES ('2026-10-05', 1, 'planned', 'g', '2026-10-05T00:00:00Z')",
      );
      week.syncWeek({}, NOW);
      assert.equal(all('SELECT * FROM planned_days').length, 1);
      assert.equal(all('SELECT * FROM plan_generations').length, 0);
    },
  ],
];

async function main() {
  console.log(`CASES ${CASES.length}`);
  for (const [name, run] of CASES) {
    try {
      await run();
      console.log(`RESULT ${JSON.stringify({ name, ok: true })}`);
    } catch (error) {
      console.log(
        `RESULT ${JSON.stringify({ name, ok: false, error: error.stack ?? String(error) })}`,
      );
    }
  }
}
main().finally(() => current.native?.close());
