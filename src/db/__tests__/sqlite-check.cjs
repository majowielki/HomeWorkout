/* Real SQLite plus the production Expo Drizzle driver. Only the native
 * boundary is adapted; query execution and transaction behaviour are real.
 * Run in a Node child because Jest's RN environment has no native SQLite.
 *
 * Every case gets a fresh in-memory database (migrated and, unless it says
 * otherwise, seeded), so a failure names one behaviour and never depends on
 * what an earlier case left behind. The script prints one RESULT line per
 * case; storage.test.ts turns each into its own Jest test. */
const {
  assert,
  current,
  schema,
  openDatabase,
  seed,
  all,
  exec,
  failInsert,
  seeded,
  firstExerciseId,
} = require('./sqlite-harness.cjs');
const week = require('../repositories/constraints.ts');
const backup = require('../repositories/backup.ts');
const calendar = require('../repositories/calendar.ts');
const blocks = require('../repositories/trainingBlocks.ts');
const diary = require('../repositories/dailyLogs.ts');
const workoutRepo = require('../repositories/workouts.ts');
const setRepo = require('../repositories/setLogs.ts');
const coachSource = require('../repositories/coachSource.ts');
const { buildCoachContext } = require('../../ai/context/buildCoachContext.ts');

const blockState = {
  index: 1,
  startedOn: '2026-10-01',
  deloadFrom: null,
  deloadReason: null,
  selections: {},
};

/** A completed main session on 2026-10-01 with one working and one warm-up set. */
function completedSession(exerciseId, workoutId = 'inside') {
  current.db
    .insert(schema.workouts)
    .values({
      id: workoutId,
      trainingDate: '2026-10-01',
      startedAt: '2026-10-02T00:30:00Z',
      status: 'completed',
    })
    .run();
  current.db
    .insert(schema.setLogs)
    .values([
      {
        id: `${workoutId}-work`,
        workoutId,
        exerciseId,
        exerciseOrder: 0,
        setIndex: 1,
        reps: 10,
        rir: 3,
        isWarmup: false,
        loggedAt: '2026-10-02T00:30:00Z',
      },
      {
        id: `${workoutId}-warm`,
        workoutId,
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
}

const CASES = [
  [
    'a first seed that fails halfway leaves no profile and no catalogue',
    async () => {
      openDatabase();
      const drop = failInsert('fail_seed', 'bands');
      await assert.rejects(seed.seedDatabase());
      assert.equal(all('SELECT * FROM user_profile').length, 0);
      assert.equal(all('SELECT * FROM exercises').length, 0);
      drop();
      await seed.seedDatabase();
      assert.equal(all('SELECT * FROM user_profile').length, 1);
      assert.ok(all('SELECT * FROM exercises').length > 100);
    },
  ],
  [
    'a calendar day override rolls back on failure and keeps muscle restrictions',
    async () => {
      await seeded();
      await week.setDayTraining('2026-10-08', false);
      const before = await week.getActiveConstraints('2026-10-07');
      const drop = failInsert('fail_constraint', 'plan_constraints');
      await assert.rejects(week.setDayTraining('2026-10-08', true));
      assert.deepEqual(await week.getActiveConstraints('2026-10-07'), before);
      drop();
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
    },
  ],
  [
    'a block rotation that fails keeps the open block',
    async () => {
      await seeded();
      const original = await blocks.saveBlockAdvance(
        null,
        { block: blockState, closed: null, events: [] },
        '2026-10-07',
      );
      const drop = failInsert('fail_block', 'training_blocks');
      await assert.rejects(
        blocks.saveBlockAdvance(
          original,
          { block: { ...blockState, index: 2 }, closed: blockState, events: [] },
          '2026-10-08',
        ),
      );
      drop();
      assert.equal((await blocks.getCurrentBlock()).id, original.id);
    },
  ],
  [
    'the calendar reads only its date range, with working-set counts, rides and the diary',
    async () => {
      await seeded();
      const exerciseId = firstExerciseId();
      current.db
        .insert(schema.workouts)
        .values([
          {
            id: 'before',
            trainingDate: '2026-09-30',
            startedAt: '2026-10-01T00:30:00Z',
            status: 'completed',
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
      completedSession(exerciseId);
      current.db
        .insert(schema.cardioLogs)
        .values({
          id: 'ride',
          workoutId: 'inside',
          trainingDate: '2026-10-01',
          purpose: 'warmup',
          minutes: 10,
          loggedAt: '2026-10-02T00:10:00Z',
        })
        .run();
      current.db
        .insert(schema.dailyLogs)
        .values({ date: '2026-10-01', energy: 4, updatedAt: 'now' })
        .run();
      const range = await calendar.getCalendarRange('2026-10-01', '2026-10-31');
      assert.deepEqual(
        range.sessions.map((s) => s.workout.id),
        ['inside', 'last'],
      );
      assert.equal(range.sessions[0].sets, 1);
      assert.equal('templateName' in range.sessions[0], false);
      assert.equal(range.rides[0].workoutId, 'inside');
      assert.equal(range.diary[0].energy, 4);
      assert.equal(range.days.length, 0, 'obsolete week rows are not calendar forecasts');
      current.db
        .insert(schema.plannedDays)
        .values({
          date: '2026-10-08',
          selection: null,
          forecast: null,
          status: 'planned',
          generationId: 'current-week',
          updatedAt: 'now',
        })
        .run();
      assert.equal(
        (await calendar.getCalendarRange('2026-10-01', '2026-10-31')).days[0].date,
        '2026-10-08',
      );
      assert.equal(
        (await calendar.getCalendarRange('2020-01-01', '2020-01-31')).sessions.length,
        0,
      );
    },
  ],
  [
    'mild soreness lowers only the named muscles and keeps the rest of the diary',
    async () => {
      await seeded();
      current.db
        .insert(schema.dailyLogs)
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
      assert.deepEqual(
        [mild.energy, mild.sleepHours, mild.stress, mild.steps, mild.note],
        [3, 7, 2, 2000, 'unchanged diary'],
      );
      await diary.recordMildSoreness('2026-10-08', ['calves']);
      assert.deepEqual((await diary.getDailyLog('2026-10-08')).soreness, { calves: 2 });
      assert.equal((await diary.getDailyLog('2026-10-08')).sleepHours, null);
    },
  ],
  [
    'a request applies within its dates and can be taken back',
    async () => {
      await seeded();
      const id = await week.addConstraint({
        kind: 'avoid_muscle',
        muscles: ['back'],
        from: '2026-10-07',
        until: '2026-10-08',
        reason: 'doms',
        source: 'user',
        note: null,
      });
      assert.ok((await week.getActiveConstraints('2026-10-08')).some((c) => c.id === id));
      assert.ok(!(await week.getActiveConstraints('2026-10-09')).some((c) => c.id === id));
      await week.revokeConstraints([id]);
      assert.ok(!(await week.getActiveConstraints('2026-10-07')).some((c) => c.id === id));
      assert.ok(all('SELECT revoked_at FROM plan_constraints WHERE id = ?', id)[0].revoked_at);
    },
  ],
  [
    'a session left in progress past the threshold is abandoned on start',
    async () => {
      await seeded();
      const exerciseId = firstExerciseId();
      completedSession(exerciseId);
      const id = 'stale';
      current.db
        .insert(schema.workouts)
        .values({
          id,
          trainingDate: '2026-10-09',
          startedAt: new Date().toISOString(),
          status: 'in_progress',
        })
        .run();
      await workoutRepo.abandonStaleWorkouts(new Date(Date.now() + 11 * 60 * 60 * 1000));
      assert.equal((await workoutRepo.getWorkout(id)).status, 'in_progress');
      await workoutRepo.abandonStaleWorkouts(new Date(Date.now() + 13 * 60 * 60 * 1000));
      assert.equal((await workoutRepo.getWorkout(id)).status, 'abandoned');
    },
  ],
  [
    'training on one day of a coach rest request keeps the days around it, atomically',
    async () => {
      await seeded();
      await week.addConstraint({
        kind: 'rest_day',
        muscles: [],
        from: '2026-10-09',
        until: '2026-10-11',
        reason: 'busy',
        source: 'coach',
        note: 'accepted rest',
      });
      await week.setDayTraining('2026-10-10', true);
      const coachRest = async () =>
        (await week.getActiveConstraints('2026-10-09')).filter(
          (c) => c.source === 'coach' && c.kind === 'rest_day',
        );
      assert.deepEqual(
        (await coachRest()).map((c) => [c.from, c.until]),
        [
          ['2026-10-09', '2026-10-09'],
          ['2026-10-11', '2026-10-11'],
        ],
      );
      const before = await week.getActiveConstraints('2026-10-09');
      const drop = failInsert('fail_rest_undo', 'plan_constraints');
      await assert.rejects(week.setDayTraining('2026-10-09', true));
      assert.deepEqual(await week.getActiveConstraints('2026-10-09'), before);
      drop();
      await week.setDayTraining('2026-10-09', true);
      assert.equal((await coachRest()).length, 1);
    },
  ],
  [
    'a set keeps why it fell short, through a backup',
    async () => {
      await seeded();
      const exerciseId = firstExerciseId();
      completedSession(exerciseId);
      const id = 'legacy-shortfall';
      current.db
        .insert(schema.setLogs)
        .values({
          id,
          workoutId: 'inside',
          exerciseId,
          exerciseOrder: 1,
          setIndex: 1,
          reps: 6,
          rir: 1,
          shortfall: 'doms',
          loggedAt: '2026-10-01T12:00:00Z',
        })
        .run();
      assert.equal((await setRepo.getSet(id)).shortfall, 'doms');
      const saved = await backup.dumpAll();
      await backup.restoreAll(saved);
      assert.equal((await setRepo.getSet(id)).shortfall, 'doms');
    },
  ],
  [
    'the calendar sees a day composed with the coach until it is taken back',
    async () => {
      await seeded();
      const composed = (date) => ({
        kind: 'compose_day',
        muscles: [],
        from: date,
        until: date,
        reason: 'other',
        source: 'coach',
        note: null,
        items: [{ slotId: 'push', sets: 2 }],
      });
      const inside = await week.addConstraint(composed('2026-10-09'));
      await week.addConstraint(composed('2026-11-02'));
      await week.addConstraint({
        ...composed('2026-10-10'),
        kind: 'lighter_day',
        items: undefined,
      });
      const range = async () =>
        (await calendar.getCalendarRange('2026-10-01', '2026-10-31')).composed;
      assert.deepEqual(await range(), [{ id: inside, date: '2026-10-09' }]);
      await week.revokeConstraints([inside]);
      assert.deepEqual(await range(), []);
    },
  ],
  [
    'reported shortfalls travel from real SQLite to the strict coach context',
    async () => {
      await seeded();
      const exerciseId = firstExerciseId();
      completedSession(exerciseId);
      exec("UPDATE set_logs SET shortfall = 'short_rest' WHERE id = 'inside-work'");
      exec("UPDATE set_logs SET shortfall = 'pain' WHERE id = 'inside-warm'");
      const source = await coachSource.loadCoachSource(new Date('2026-10-08T12:00:00Z'));
      assert.equal(source.sets.find((s) => s.id === 'inside-work').shortfall, 'short_rest');
      const context = buildCoachContext(source).context;
      assert.equal(context.sessions[0].exercises[0].sets[0].shortfall, 'short_rest');
      assert.equal(context.sessions[0].exercises[0].sets.length, 1);
      exec("UPDATE set_logs SET shortfall = NULL WHERE id = 'inside-work'");
      const legacy = await coachSource.loadCoachSource(new Date('2026-10-08T12:00:00Z'));
      assert.equal(
        buildCoachContext(legacy).context.sessions[0].exercises[0].sets[0].shortfall,
        null,
      );
    },
  ],
  [
    'a corrupt backup changes nothing; a valid one restores history and drops the derived week',
    async () => {
      await seeded();
      const exerciseId = firstExerciseId();
      completedSession(exerciseId);
      current.db
        .insert(schema.plannedDays)
        .values({ date: '2026-10-08', status: 'planned', generationId: 'g', updatedAt: 'now' })
        .run();
      const saved = await backup.dumpAll();
      const corrupted = structuredClone(saved);
      corrupted.tables.bands.push(corrupted.tables.bands[0]); // a duplicate key after the deletes
      await assert.rejects(backup.restoreAll(corrupted));
      assert.deepEqual(await backup.dumpAll(new Date(saved.exportedAt)), saved);
      await backup.restoreAll(saved);
      assert.equal(all('SELECT * FROM workouts').length, 1);
      assert.equal(all('SELECT * FROM set_logs').length, 2);
      // History is restored; the planned week is derived and rebuilt on the next focus.
      assert.equal(all('SELECT * FROM planned_days').length, 0);
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
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.log(`RESULT ${JSON.stringify({ name, ok: false, error: message })}`);
    }
  }
}

main().finally(() => current.native?.close());
