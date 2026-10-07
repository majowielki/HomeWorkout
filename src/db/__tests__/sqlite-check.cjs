/* global __dirname */
/* Real SQLite plus the production Expo Drizzle driver. Only the native
 * boundary is adapted; query execution and transaction behavior are real.
 * Run in a Node child because Jest's RN environment has no native SQLite. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('tsx/cjs');

const root = path.resolve(__dirname, '../../..');
const native = new DatabaseSync(':memory:');
for (const file of fs
  .readdirSync(path.join(root, 'src/db/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  native.exec(fs.readFileSync(path.join(root, 'src/db/migrations', file), 'utf8'));
}
native.exec('PRAGMA foreign_keys = ON');
const client = {
  prepareSync(sql) {
    const statement = native.prepare(sql);
    return {
      executeSync(params) {
        const result = statement.run(...params);
        return {
          ...result,
          getAllSync: () => statement.all(...params),
          getFirstSync: () => statement.get(...params),
        };
      },
      executeForRawResultSync(params) {
        return { getAllSync: () => statement.all(...params).map((r) => Object.values(r)) };
      },
    };
  },
};
const schema = require('../schema.ts');
const { drizzle } = require('drizzle-orm/expo-sqlite/driver');
const db = drizzle(client, { schema });
const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'expo-crypto') return { randomUUID };
  if (
    (request === '../client' || request === './client') &&
    parent.filename.startsWith(path.join(root, 'src/db'))
  )
    return { db, sqlite: client };
  return originalLoad.call(this, request, parent, ...rest);
};
const seed = require('../seed.ts');
const week = require('../repositories/weekPlan.ts');
const backup = require('../repositories/backup.ts');
const calendar = require('../repositories/calendar.ts');
const blocks = require('../repositories/trainingBlocks.ts');
const diary = require('../repositories/dailyLogs.ts');
const all = (sql) => native.prepare(sql).all();

async function main() {
  // A failure late in the first seed must roll the profile back as well.
  native.exec(
    "CREATE TRIGGER fail_seed BEFORE INSERT ON bands BEGIN SELECT RAISE(ABORT, 'seed failure'); END",
  );
  await assert.rejects(seed.seedDatabase());
  assert.equal(all('SELECT * FROM user_profile').length, 0);
  assert.equal(all('SELECT * FROM exercises').length, 0);
  native.exec('DROP TRIGGER fail_seed');
  await seed.seedDatabase();
  assert.equal(all('SELECT * FROM user_profile').length, 1);
  assert.ok(all('SELECT * FROM exercises').length > 100);

  await week.setDayTraining('2026-10-08', false);
  const before = await week.getActiveConstraints('2026-10-07');
  native.exec(
    "CREATE TRIGGER fail_constraint BEFORE INSERT ON plan_constraints BEGIN SELECT RAISE(ABORT, 'constraint failure'); END",
  );
  await assert.rejects(week.setDayTraining('2026-10-08', true));
  assert.deepEqual(await week.getActiveConstraints('2026-10-07'), before);
  native.exec('DROP TRIGGER fail_constraint');
  await week.addConstraint({
    kind: 'avoid_muscle',
    muscles: ['quads'],
    from: '2026-10-08',
    until: '2026-10-08',
    reason: 'pain',
    source: 'user',
    note: null,
  });
  await week.setDayTraining('2026-10-08', true);
  const after = await week.getActiveConstraints('2026-10-07');
  assert.deepEqual(after.map((c) => c.kind).sort(), ['avoid_muscle', 'train_day']);

  const write = {
    statusUpdates: [],
    rows: [{ date: '2026-10-08', selection: null, forecast: null, status: 'planned' }],
    trigger: 'horizon',
    fromDate: '2026-10-08',
    changes: [],
  };
  await week.saveWeek(write);
  const generations = all('SELECT * FROM plan_generations');
  native.exec(
    "CREATE TRIGGER fail_day BEFORE INSERT ON planned_days WHEN NEW.date = '2026-10-10' BEGIN SELECT RAISE(ABORT, 'day failure'); END",
  );
  await assert.rejects(
    week.saveWeek({
      ...write,
      statusUpdates: [{ date: '2026-10-08', status: 'missed' }],
      rows: [
        { ...write.rows[0], date: '2026-10-09' },
        { ...write.rows[0], date: '2026-10-10' },
      ],
    }),
  );
  assert.deepEqual(all('SELECT * FROM plan_generations'), generations);
  assert.equal((await week.getPlannedDays('2026-10-01', '2026-10-31')).length, 1);
  assert.equal((await week.getPlannedDays('2026-10-08', '2026-10-08'))[0].status, 'planned');
  native.exec('DROP TRIGGER fail_day');

  const state = {
    index: 1,
    startedOn: '2026-10-01',
    deloadFrom: null,
    deloadReason: null,
    selections: {},
  };
  const original = await blocks.saveBlockAdvance(
    null,
    { block: state, closed: null, events: [] },
    '2026-10-07',
  );
  native.exec(
    "CREATE TRIGGER fail_block BEFORE INSERT ON training_blocks BEGIN SELECT RAISE(ABORT, 'block failure'); END",
  );
  await assert.rejects(
    blocks.saveBlockAdvance(
      original,
      { block: { ...state, index: 2 }, closed: state, events: [] },
      '2026-10-08',
    ),
  );
  assert.equal((await blocks.getCurrentBlock()).id, original.id);
  native.exec('DROP TRIGGER fail_block');

  const templateId = all('SELECT id FROM workout_templates')[0].id;
  const exerciseId = all('SELECT id FROM exercises')[0].id;
  db.insert(schema.workouts)
    .values([
      {
        id: 'before',
        trainingDate: '2026-09-30',
        startedAt: '2026-10-01T00:30:00Z',
        status: 'completed',
        templateId,
      },
      {
        id: 'inside',
        trainingDate: '2026-10-01',
        startedAt: '2026-10-02T00:30:00Z',
        status: 'completed',
        templateId,
      },
      {
        id: 'last',
        trainingDate: '2026-10-31',
        startedAt: '2026-11-01T00:30:00Z',
        status: 'completed',
      },
      {
        id: 'outside',
        trainingDate: '2026-11-01',
        startedAt: '2026-11-01T12:30:00Z',
        status: 'completed',
      },
    ])
    .run();
  db.insert(schema.setLogs)
    .values([
      {
        id: 'work',
        workoutId: 'inside',
        exerciseId,
        exerciseOrder: 0,
        setIndex: 1,
        reps: 10,
        rir: 3,
        isWarmup: false,
        loggedAt: '2026-10-02T00:30:00Z',
      },
      {
        id: 'warm',
        workoutId: 'inside',
        exerciseId,
        exerciseOrder: 0,
        setIndex: 0,
        reps: 10,
        rir: 5,
        isWarmup: true,
        loggedAt: '2026-10-02T00:30:00Z',
      },
    ])
    .run();
  db.insert(schema.cardioLogs)
    .values({
      id: 'ride',
      workoutId: 'inside',
      trainingDate: '2026-10-01',
      purpose: 'warmup',
      minutes: 10,
      loggedAt: '2026-10-02T00:10:00Z',
    })
    .run();
  db.insert(schema.dailyLogs).values({ date: '2026-10-01', energy: 4, updatedAt: 'now' }).run();
  const range = await calendar.getCalendarRange('2026-10-01', '2026-10-31');
  assert.deepEqual(
    range.sessions.map((s) => s.workout.id),
    ['inside', 'last'],
  );
  assert.equal(range.sessions[0].sets, 1);
  assert.ok(range.sessions[0].templateName);
  assert.equal(range.sessions[1].templateName, null);
  assert.equal(range.rides[0].workoutId, 'inside');
  assert.equal(range.diary[0].energy, 4);
  assert.equal(range.days[0].date, '2026-10-08');
  assert.equal((await calendar.getCalendarRange('2020-01-01', '2020-01-31')).sessions.length, 0);

  db.insert(schema.dailyLogs)
    .values({
      date: '2026-10-07',
      energy: 3,
      stress: 2,
      sleepHours: 7,
      steps: 2000,
      note: 'unchanged diary',
      soreness: { quads: 4, back: 4 },
      updatedAt: 'before',
    })
    .run();
  await diary.recordMildSoreness('2026-10-07', ['quads']);
  const mild = await diary.getDailyLog('2026-10-07');
  assert.deepEqual(mild.soreness, { quads: 2, back: 4 });
  assert.equal(mild.energy, 3);
  assert.equal(mild.sleepHours, 7);
  assert.equal(mild.stress, 2);
  assert.equal(mild.steps, 2000);
  assert.equal(mild.note, 'unchanged diary');
  await diary.recordMildSoreness('2026-10-08', ['calves']);
  assert.deepEqual((await diary.getDailyLog('2026-10-08')).soreness, { calves: 2 });
  assert.equal((await diary.getDailyLog('2026-10-08')).sleepHours, null);
  const sorenessId = await week.addConstraint({
    kind: 'avoid_muscle',
    muscles: ['back'],
    from: '2026-10-07',
    until: '2026-10-08',
    reason: 'doms',
    source: 'user',
    note: null,
  });
  assert.ok((await week.getActiveConstraints('2026-10-08')).some((c) => c.id === sorenessId));
  assert.ok(!(await week.getActiveConstraints('2026-10-09')).some((c) => c.id === sorenessId));
  await week.revokeConstraints([sorenessId]);
  assert.ok(!(await week.getActiveConstraints('2026-10-07')).some((c) => c.id === sorenessId));
  assert.ok(
    native.prepare('SELECT revoked_at FROM plan_constraints WHERE id = ?').get(sorenessId)
      .revoked_at,
  );

  const saved = await backup.dumpAll();
  const corrupted = structuredClone(saved);
  corrupted.tables.bands.push(corrupted.tables.bands[0]); // duplicate key after deletes and profile insertion
  await assert.rejects(backup.restoreAll(corrupted));
  assert.deepEqual(await backup.dumpAll(new Date(saved.exportedAt)), saved);
  await backup.restoreAll(saved);
  assert.equal(all('SELECT * FROM workouts').length, 4);
  assert.equal(all('SELECT * FROM set_logs').length, 2);
  assert.equal(all('SELECT * FROM planned_days').length, 0); // history restored, forecast rebuilt on focus
  console.log(
    'SQLite: seed, day override, week and block rollback; calendar date range; backup rollback and restore passed',
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => native.close());
