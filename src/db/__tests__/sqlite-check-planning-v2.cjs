/* P5.5: the day of engine v2 on real SQLite: preview reads and writes nothing,
 * acceptance plans again in its own transaction, compares with what was shown and starts
 * the session and moves the block together or not at all. */
const { assert, current, all, exec, seeded, failInsert } = require('./sqlite-harness.cjs');
const { previewDay, acceptDay } = require('../repositories/planningV2.ts');
const { loadSessionChangeSource } = require('../repositories/sessionChangeSource.ts');
const { assessSessionChange } = require('../../domain/session/assess.ts');
const { doTheSession } = require('./sqlite-day-helpers.cjs');

// Local time on purpose: the training day is the local date minus the day boundary.
const NOW = new Date(2026, 9, 5, 9, 0, 0);
const LATER = new Date(2026, 9, 5, 9, 4, 0);
const TOMORROW = new Date(2026, 9, 6, 9, 0, 0);
const request = (sessionId = 'day-1', patch = {}) => ({ sessionId, ...patch });

const TABLES = [
  'workouts',
  'set_logs',
  'set_dispositions',
  'session_plan_revisions',
  'command_ledger',
  'planning_revisions',
  'exposure_outcomes',
  'training_blocks',
  'daily_logs',
];
function snapshot() {
  return Object.fromEntries(TABLES.map((t) => [t, all(`SELECT * FROM ${t}`)]));
}
function ready(day) {
  assert.ok(['ready', 'adjusted'].includes(day.output.result.kind), day.output.result.kind);
  return day.output.result.plan;
}
function accept(commandId, day, patch = {}, now = LATER) {
  return acceptDay(
    {
      commandId,
      request: request('day-1'),
      expectedPlanHash: day.planHash,
      timeZone: 'Europe/Warsaw',
      ...patch,
    },
    now,
  );
}

const CASES = [
  [
    'starting today keeps the weekly choice and refuses a changed selection after preview',
    async () => {
      await seeded();
      const { syncWeek } = require('../repositories/weekPlanV2.ts');
      syncWeek({}, NOW);
      const day = previewDay(request(), NOW);
      const saved = JSON.parse(
        all("SELECT selection FROM planned_days_v2 WHERE date = '2026-10-05'")[0].selection,
      );
      assert.deepEqual(day.output.selection, saved);
      const changed = saved.map((item) => ({ ...item, sets: 1 }));
      current.native
        .prepare("UPDATE planned_days_v2 SET selection = ? WHERE date = '2026-10-05'")
        .run(JSON.stringify(changed));
      assert.equal(accept('changed-choice', day).kind, 'conflict');
      assert.equal(all('SELECT * FROM workouts').length, 0);
      assert.equal(all('SELECT * FROM training_blocks').length, 0);
      const fresh = previewDay(request(), NOW);
      assert.deepEqual(fresh.output.selection, changed);
      assert.equal(accept('fresh-choice', fresh).kind, 'committed');
    },
  ],
  [
    'today syncs the week and a completed workout becomes recovery and a future preview',
    async () => {
      await seeded();
      const { readToday } = require('../../features/plan/today.ts');
      const today = readToday(undefined, NOW);
      assert.equal(today.done, false);
      assert.ok(today.plan.exposures.length > 0);
      assert.ok(today.week.length > 0);
      assert.equal(today.plan.audit.planHash, today.preview.planHash);
      const accepted = acceptDay(
        {
          commandId: 'today-start',
          request: today.preview.request,
          expectedPlanHash: today.preview.planHash,
          timeZone: 'Europe/Warsaw',
        },
        NOW,
      );
      assert.equal(accepted.kind, 'committed');
      doTheSession(today.plan, NOW);
      assert.equal(
        all("SELECT status FROM planned_days_v2 WHERE date = '2026-10-05'")[0].status,
        'done',
      );
      const done = readToday(undefined, LATER);
      assert.equal(done.done, true);
      assert.equal(done.plan, null);
      assert.ok(done.recovery.length > 0);
      assert.ok(Object.values(done.volume).some((v) => v.certain > 0));
      const { listWorkouts } = require('../repositories/workouts.ts');
      const count = (await listWorkouts())[0].workingSets;
      current.native
        .prepare(
          'UPDATE set_logs SET deleted_at = ? WHERE id = (SELECT id FROM set_logs WHERE is_warmup = 0 LIMIT 1)',
        )
        .run(LATER.toISOString());
      assert.equal((await listWorkouts())[0].workingSets, count - 1);
      assert.equal(
        done.week.some((d) => d.date > done.asOf && d.forecast !== null),
        true,
      );
    },
  ],
  [
    'the preview plans a day from an empty database and writes nothing',
    async () => {
      await seeded();
      const before = snapshot();
      const day = previewDay(request(), NOW);
      const plan = ready(day);
      assert.equal(day.asOf, '2026-10-05');
      assert.equal(plan.trainingDate, '2026-10-05');
      assert.equal(plan.sessionId, 'day-1');
      assert.ok(plan.exposures.length > 0);
      assert.equal(day.planHash, plan.audit.planHash);
      assert.equal(day.current, null);
      assert.equal(day.advance.block.index, 1);
      assert.deepEqual(snapshot(), before);
    },
  ],
  [
    'the same database and request give the same plan at any time of the day',
    async () => {
      await seeded();
      const a = previewDay(request(), NOW);
      const b = previewDay(request(), LATER);
      assert.equal(a.planHash, b.planHash);
      assert.deepEqual(a.output.result, b.output.result);
    },
  ],
  [
    'another session id is another plan, the same inputs aside',
    async () => {
      await seeded();
      assert.notEqual(
        previewDay(request('a'), NOW).planHash,
        previewDay(request('b'), NOW).planHash,
      );
    },
  ],
  [
    'acceptance starts the session with the plan that was shown, opens the block and counts both',
    async () => {
      await seeded();
      const day = previewDay(request(), NOW);
      const plan = ready(day);
      const r = accept('accept-1', day);
      assert.equal(r.kind, 'committed');
      assert.deepEqual(r.result, { sessionId: 'day-1' });
      const [row] = all('SELECT * FROM workouts');
      assert.equal(row.id, 'day-1');
      assert.equal(row.status, 'in_progress');
      assert.equal(row.plan_schema, 2);
      assert.deepEqual(JSON.parse(row.plan_v2), JSON.parse(JSON.stringify(plan)));
      const blocks = all('SELECT * FROM training_blocks');
      assert.equal(blocks.length, 1);
      assert.equal(blocks[0].closed_on, null);
      assert.deepEqual(JSON.parse(blocks[0].selections), day.advance.block.selections);
      const revisions = Object.fromEntries(
        all('SELECT domain, revision FROM planning_revisions').map((x) => [x.domain, x.revision]),
      );
      assert.equal(revisions.block, 1);
      assert.ok(revisions.history >= 1);
      assert.equal(all('SELECT * FROM command_ledger').length, 1);
    },
  ],
  [
    'the started session is one the consultation can read and the audit accepts',
    async () => {
      await seeded();
      const day = previewDay(request(), NOW);
      assert.equal(accept('accept-1', day).kind, 'committed');
      const source = loadSessionChangeSource('day-1');
      assert.equal(source.session.plan.sessionId, 'day-1');
      assert.equal(source.problems.length, 0);
      const exposure = source.session.plan.exposures[0];
      const assessed = assessSessionChange(source.snap, source.session, {
        kind: 'skip_remaining',
        exposureId: exposure.id,
      });
      assert.equal(
        assessed.checks.filter((c) => c.class === 'hard' && c.status === 'fail').length,
        0,
      );
      assert.notEqual(assessed.patch, null);
    },
  ],
  [
    'sending the accepted command again returns the stored answer and writes nothing',
    async () => {
      await seeded();
      const day = previewDay(request(), NOW);
      assert.equal(accept('accept-1', day).kind, 'committed');
      const before = snapshot();
      const again = accept('accept-1', day, {}, TOMORROW);
      assert.equal(again.kind, 'already_committed');
      assert.deepEqual(again.result, { sessionId: 'day-1' });
      assert.deepEqual(snapshot(), before);
    },
  ],
  [
    'an input that changed after the preview is a conflict and nothing is written',
    async () => {
      await seeded();
      const day = previewDay(request(), NOW);
      exec(
        "INSERT INTO daily_logs (date, sleep_hours, energy, updated_at) VALUES ('2026-10-05', 4, 1, '2026-10-05T08:00:00Z')",
      );
      const before = snapshot();
      const r = accept('accept-1', day);
      assert.equal(r.kind, 'conflict');
      assert.equal(r.code, 'STALE_INPUT');
      assert.notEqual(r.detail, day.planHash);
      assert.equal(r.detail, previewDay(request(), NOW).planHash);
      assert.deepEqual(snapshot(), before);
    },
  ],
  [
    'the day turning over between the preview and the acceptance is a conflict',
    async () => {
      await seeded();
      const day = previewDay(request(), NOW);
      const r = accept('accept-1', day, {}, TOMORROW);
      assert.equal(r.kind, 'conflict');
      assert.equal(r.code, 'STALE_INPUT');
      assert.equal(all('SELECT * FROM workouts').length, 0);
      assert.equal(all('SELECT * FROM training_blocks').length, 0);
    },
  ],
  [
    'a hash that is not the day the person saw is refused',
    async () => {
      await seeded();
      const r = accept('accept-1', { planHash: '0'.repeat(64) });
      assert.equal(r.kind, 'conflict');
      assert.equal(r.code, 'STALE_INPUT');
      assert.equal(all('SELECT * FROM workouts').length, 0);
    },
  ],
  [
    'a running session blocks the acceptance and leaves the block as it was',
    async () => {
      await seeded();
      const first = previewDay(request('day-1'), NOW);
      assert.equal(accept('accept-1', first).kind, 'committed');
      const second = previewDay(request('day-2', { kind: 'extra' }), LATER);
      const before = snapshot();
      const r = acceptDay(
        {
          commandId: 'accept-2',
          request: request('day-2', { kind: 'extra' }),
          expectedPlanHash: second.planHash,
          timeZone: null,
        },
        LATER,
      );
      assert.equal(r.kind, 'conflict');
      assert.equal(r.code, 'ACTIVE_SESSION_EXISTS');
      assert.deepEqual(snapshot(), before);
    },
  ],
  [
    'a failure while writing the block takes the session and the ledger back with it',
    async () => {
      await seeded();
      const day = previewDay(request(), NOW);
      const undo = failInsert('no_block', 'training_blocks');
      const before = snapshot();
      const r = accept('accept-1', day);
      undo();
      assert.equal(r.kind, 'storage_error');
      assert.equal(r.retryable, true);
      assert.deepEqual(snapshot(), before);
      assert.equal(accept('accept-1', day).kind, 'committed');
    },
  ],
  [
    'a day with no plan is refused and writes nothing',
    async () => {
      await seeded();
      exec("UPDATE user_profile SET rest_weekdays = '[0,1,2,3,4,5,6]'");
      const day = previewDay(request(), NOW);
      assert.equal(day.planHash, null);
      const before = snapshot();
      const r = accept('accept-1', day);
      assert.equal(r.kind, 'rejected');
      assert.equal(r.code, 'INVALID_PLAN');
      assert.deepEqual(snapshot(), before);
    },
  ],
  [
    'six days in a row: each day is planned from the database, done as planned and closed, and the next one reads it',
    async () => {
      await seeded();
      const codes = [];
      for (let i = 0; i < 6; i += 1) {
        const at = new Date(2026, 9, 5 + i, 9, 0, 0);
        const day = previewDay(request(`d${i}`), at);
        const plan = ready(day);
        for (const e of plan.exposures) codes.push(e.trace.code);
        assert.equal(
          accept(`accept-${i}`, day, { request: request(`d${i}`) }, new Date(+at + 60000)).kind,
          'committed',
        );
        doTheSession(plan, new Date(+at + 120000));
      }
      assert.equal(all("SELECT * FROM workouts WHERE status = 'completed'").length, 6);
      assert.equal(all('SELECT * FROM training_blocks').length, 1);
      assert.ok(codes.includes('FIRST_COMPARABLE_EXPOSURE'), codes.join());
      assert.ok(
        codes.some((c) => c !== 'FIRST_COMPARABLE_EXPOSURE'),
        'later days read the earlier ones',
      );
    },
  ],
  [
    'T19 an extra session after the main one shares the balance of the day: the limit is not reset',
    async () => {
      await seeded();
      const main = previewDay(request('main'), NOW);
      const mainPlan = ready(main);
      assert.equal(accept('accept-main', main, { request: request('main') }).kind, 'committed');
      doTheSession(mainPlan, new Date(+NOW + 120000));
      const done = mainPlan.exposures.find(
        (e) =>
          e.slotId !== null &&
          e.progressionScope === 'primary' &&
          e.sets.some((q) => q.role === 'work'),
      );
      const asExtra = (id, slotId, sets = 3) =>
        request(id, { kind: 'extra', intent: 'extra', only: [{ slotId, sets }] });
      const at = new Date(+NOW + 600000);
      // The muscle that has had its sets today has no room: the extra session says so instead of a fresh three.
      const full = previewDay(asExtra('extra-0', done.slotId), at);
      assert.equal(full.planHash, null);
      assert.equal(full.output.result.kind, 'no_feasible_plan');
      // A movement of untouched muscles can be added, and it is an extra session of the same day.
      const slots = require('../../../data/slots.json').slots.filter((x) => x.kind !== 'filler');
      let shown = null;
      for (const slot of slots) {
        const day = previewDay(asExtra('extra-1', slot.id, 2), at);
        if (day.planHash !== null) {
          shown = day;
          break;
        }
      }
      assert.notEqual(shown, null, 'some movement still has room');
      const plan = ready(shown);
      assert.equal(plan.kind, 'extra');
      assert.equal(plan.sessionId, 'extra-1');
      assert.equal(plan.trainingDate, mainPlan.trainingDate);
      const accepted = acceptDay(
        {
          commandId: 'accept-extra',
          request: shown.request,
          expectedPlanHash: shown.planHash,
          timeZone: null,
        },
        new Date(+NOW + 660000),
      );
      assert.equal(accepted.kind, 'committed', JSON.stringify(accepted));
      assert.equal(all("SELECT * FROM workouts WHERE status = 'in_progress'").length, 1);
      // An extra session does not move the block.
      assert.equal(all('SELECT * FROM training_blocks').length, 1);
    },
  ],
  [
    'the block carries on from the open one and a new day moves nothing it need not',
    async () => {
      await seeded();
      const day = previewDay(request(), NOW);
      assert.equal(accept('accept-1', day).kind, 'committed');
      exec("UPDATE workouts SET status = 'abandoned'");
      const next = previewDay(request('day-2'), TOMORROW);
      assert.equal(next.current.state.index, 1);
      assert.equal(next.advance.block.index, 1);
      assert.deepEqual(next.advance.block.selections, day.advance.block.selections);
      assert.equal(
        accept('accept-2', next, { request: request('day-2') }, TOMORROW).kind,
        'committed',
      );
      assert.equal(all('SELECT * FROM training_blocks').length, 1);
      const revisions = Object.fromEntries(
        all('SELECT domain, revision FROM planning_revisions').map((x) => [x.domain, x.revision]),
      );
      assert.equal(revisions.block, 1);
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
