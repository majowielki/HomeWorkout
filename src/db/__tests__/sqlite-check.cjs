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
  root,
  path,
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
const week = require('../repositories/weekPlan.ts');
const backup = require('../repositories/backup.ts');
const calendar = require('../repositories/calendar.ts');
const blocks = require('../repositories/trainingBlocks.ts');
const diary = require('../repositories/dailyLogs.ts');
const workoutRepo = require('../repositories/workouts.ts');
const plannerSource = require('../repositories/plannerSource.ts');
const setRepo = require('../repositories/setLogs.ts');
const coachSource = require('../repositories/coachSource.ts');
const { buildCoachContext } = require('../../ai/context/buildCoachContext.ts');

const emptyWeek = {
  statusUpdates: [],
  rows: [{ date: '2026-10-08', selection: null, forecast: null, status: 'planned' }],
  trigger: 'horizon',
  fromDate: '2026-10-08',
  changes: [],
};

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

function extraSession(exerciseId) {
  const plan = {
    version: 1,
    kind: 'extra',
    source: 'ai_accepted',
    coachProposalId: 'extra-proposal',
    date: '2026-10-01',
    blockIndex: 1,
    phase: 'work',
    regions: ['push'],
    exercises: [{ exerciseId, slotId: 'push', sets: 1 }],
    skipped: [],
    dayReasons: [],
    signals: [],
    adjustments: [],
    bike: { minutes: 10, resistance: 1, reasons: [] },
    estimatedMinutes: 4,
  };
  const selection = {
    date: plan.date,
    blockIndex: 1,
    phase: 'work',
    items: [{ exerciseId, slotId: 'push', sets: 1, role: 'work' }],
    skipped: [],
    dayReasons: [],
  };
  return { plan, selection };
}

const CASES = [
  [
    'the engine reads a main and an extra session on one date as two sessions',
    async () => {
      await seeded();
      const exerciseId = firstExerciseId();
      completedSession(exerciseId, 'main');
      current.db
        .insert(schema.workouts)
        .values({
          id: 'extra',
          trainingDate: '2026-10-01',
          startedAt: '2026-10-02T09:00:00Z',
          status: 'completed',
        })
        .run();
      current.db
        .insert(schema.setLogs)
        .values({
          id: 'extra-work',
          workoutId: 'extra',
          exerciseId,
          exerciseOrder: 0,
          setIndex: 1,
          reps: 6,
          rir: 1,
          isWarmup: false,
          loggedAt: '2026-10-02T09:10:00Z',
        })
        .run();
      const source = await plannerSource.loadPlannerSource(new Date('2026-10-03T12:00:00'));
      assert.deepEqual(
        source.sessions.map((s) => [s.date, s.sets.map((set) => set.reps)]),
        [
          ['2026-10-01', [10, 10]],
          ['2026-10-01', [6]],
        ],
      );
      assert.equal(source.lastSessionDate, '2026-10-01');
    },
  ],
  [
    'migration 0007 keeps an existing planned day as the main session (seq 1)',
    async () => {
      openDatabase({
        beforeMigration(file, native) {
          if (file === '0007_extra_sessions.sql')
            native.exec(
              "INSERT INTO planned_days VALUES ('2026-09-01', NULL, NULL, 'planned', 'old-generation', 'old-time')",
            );
        },
      });
      assert.deepEqual(
        { ...all("SELECT * FROM planned_days WHERE date = '2026-09-01'")[0] },
        {
          date: '2026-09-01',
          seq: 1,
          workout_id: null,
          selection: null,
          forecast: null,
          status: 'planned',
          generation_id: 'old-generation',
          updated_at: 'old-time',
        },
      );
    },
  ],
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
    'a new install gets no FBW templates, an old one has them refreshed',
    async () => {
      await seeded();
      assert.equal(all('SELECT * FROM workout_templates').length, 0);
      const oldTemplate = require(path.join(root, 'data/templates.json')).templates[0];
      current.db
        .insert(schema.workoutTemplates)
        .values({ id: oldTemplate.id, name: 'old name', blocks: oldTemplate.blocks, sortOrder: 0 })
        .run();
      await seed.seedDatabase();
      assert.equal(all('SELECT * FROM workout_templates').length, 1);
      assert.equal(all('SELECT * FROM workout_templates')[0].name, oldTemplate.name);
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
    'a week write that fails halfway leaves the stored week and its generations as they were',
    async () => {
      await seeded();
      await week.saveWeek(emptyWeek);
      const generations = all('SELECT * FROM plan_generations');
      const drop = failInsert('fail_day', 'planned_days', "WHEN NEW.date = '2026-10-10'");
      await assert.rejects(
        week.saveWeek({
          ...emptyWeek,
          statusUpdates: [{ date: '2026-10-08', status: 'missed' }],
          rows: [
            { ...emptyWeek.rows[0], date: '2026-10-09' },
            { ...emptyWeek.rows[0], date: '2026-10-10' },
          ],
        }),
      );
      drop();
      assert.deepEqual(all('SELECT * FROM plan_generations'), generations);
      assert.equal((await week.getPlannedDays('2026-10-01', '2026-10-31')).length, 1);
      assert.equal((await week.getPlannedDays('2026-10-08', '2026-10-08'))[0].status, 'planned');
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
      const oldTemplate = require(path.join(root, 'data/templates.json')).templates[0];
      current.db
        .insert(schema.workoutTemplates)
        .values({ id: oldTemplate.id, name: oldTemplate.name, blocks: [], sortOrder: 0 })
        .run();
      current.db
        .insert(schema.workouts)
        .values([
          {
            id: 'before',
            trainingDate: '2026-09-30',
            startedAt: '2026-10-01T00:30:00Z',
            status: 'completed',
            templateId: oldTemplate.id,
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
        .update(schema.workouts)
        .set({ templateId: oldTemplate.id })
        .where(require('drizzle-orm').eq(schema.workouts.id, 'inside'))
        .run();
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
      await week.saveWeek(emptyWeek);
      const range = await calendar.getCalendarRange('2026-10-01', '2026-10-31');
      assert.deepEqual(
        range.sessions.map((s) => s.workout.id),
        ['inside', 'last'],
      );
      assert.equal(range.sessions[0].sets, 1);
      assert.equal(range.sessions[0].templateName, oldTemplate.name);
      assert.equal(range.sessions[1].templateName, null);
      assert.equal(range.rides[0].workoutId, 'inside');
      assert.equal(range.diary[0].energy, 4);
      assert.equal(range.days[0].date, '2026-10-08');
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
    'an extra session starts atomically and once, only after the day is trained',
    async () => {
      await seeded();
      const exerciseId = firstExerciseId();
      const { plan, selection } = extraSession(exerciseId);
      await assert.rejects(workoutRepo.startExtraWorkout(plan, selection), /Complete today first/);
      completedSession(exerciseId);
      const drop = failInsert('fail_extra', 'planned_days', 'WHEN NEW.seq > 1');
      await assert.rejects(workoutRepo.startExtraWorkout(plan, selection));
      assert.equal(all('SELECT * FROM workouts').length, 1);
      drop();
      await assert.rejects(workoutRepo.startExtraWorkout({ ...plan, exercises: [] }, selection));
      await assert.rejects(
        workoutRepo.startExtraWorkout(
          { ...plan, date: '2026-10-02' },
          { ...selection, date: '2026-10-02' },
        ),
      );
      const id = await workoutRepo.startExtraWorkout(plan, selection);
      assert.equal(await workoutRepo.startExtraWorkout(plan, selection), id);
      assert.equal(all('SELECT * FROM planned_days WHERE seq = 2')[0].workout_id, id);
      assert.equal((await week.getPlannedDays(plan.date, plan.date)).length, 0);
    },
  ],
  [
    'an extra session follows its workout and the week sync never touches it',
    async () => {
      await seeded();
      const exerciseId = firstExerciseId();
      completedSession(exerciseId);
      const { plan, selection } = extraSession(exerciseId);
      const first = await workoutRepo.startExtraWorkout(plan, selection);
      await workoutRepo.completeWorkout(first, 4, null);
      assert.equal(all('SELECT * FROM planned_days WHERE seq = 2')[0].status, 'done');
      const next = await workoutRepo.startExtraWorkout(plan, selection);
      assert.equal(all('SELECT * FROM planned_days WHERE seq = 3')[0].workout_id, next);
      await week.saveWeek({
        ...emptyWeek,
        rows: [{ date: plan.date, selection, forecast: plan, status: 'planned' }],
      });
      await week.markDays([{ date: plan.date, status: 'done' }]);
      await week.refreshForecasts([
        { date: plan.date, selection: null, forecast: null, status: 'planned' },
      ]);
      assert.ok(all('SELECT forecast FROM planned_days WHERE seq = 3')[0].forecast);
      assert.equal(all('SELECT status FROM planned_days WHERE seq = 3')[0].status, 'planned');
      await workoutRepo.abandonWorkout(next);
      assert.equal(all('SELECT status FROM planned_days WHERE seq = 3')[0].status, 'missed');
      await workoutRepo.deleteWorkout(next);
      assert.equal(all('SELECT * FROM planned_days WHERE seq = 3').length, 0);
      const range = await calendar.getCalendarRange(plan.date, plan.date);
      assert.equal(range.sessions.length, 2);
      assert.equal(range.days.length, 1);
    },
  ],
  [
    'a session left in progress past the threshold is abandoned on start',
    async () => {
      await seeded();
      const exerciseId = firstExerciseId();
      completedSession(exerciseId);
      const { plan, selection } = extraSession(exerciseId);
      const id = await workoutRepo.startExtraWorkout(plan, selection);
      await workoutRepo.abandonStaleWorkouts(new Date(Date.now() + 11 * 60 * 60 * 1000));
      assert.equal((await workoutRepo.getWorkout(id)).status, 'in_progress');
      await workoutRepo.abandonStaleWorkouts(new Date(Date.now() + 13 * 60 * 60 * 1000));
      assert.equal((await workoutRepo.getWorkout(id)).status, 'abandoned');
      assert.equal(all('SELECT status FROM planned_days WHERE seq = 2')[0].status, 'missed');
    },
  ],
  [
    'an accepted coach week is all-or-nothing and accepting it twice writes it once',
    async () => {
      await seeded();
      const original = await blocks.saveBlockAdvance(
        null,
        { block: blockState, closed: null, events: [] },
        '2026-10-07',
      );
      const request = {
        id: 'preview',
        kind: 'avoid_muscle',
        muscles: ['chest'],
        from: '2026-10-08',
        until: '2026-10-09',
        reason: 'doms',
        source: 'user',
        note: 'strong soreness',
      };
      const advance = {
        block: { ...original.state, index: original.state.index + 1 },
        closed: original.state,
        events: [],
      };
      const before = await backup.dumpAll();
      const beforeDays = all('SELECT * FROM planned_days');
      const drop = failInsert('fail_coach', 'plan_generations', "WHEN NEW.trigger = 'coach'");
      await assert.rejects(
        week.saveCoachWeek('coach-proposal', [request], emptyWeek, original, advance, '2026-10-08'),
      );
      drop();
      assert.deepEqual(await backup.dumpAll(new Date(before.exportedAt)), before);
      assert.deepEqual(all('SELECT * FROM planned_days'), beforeDays);
      assert.equal((await blocks.getCurrentBlock()).id, original.id);
      for (let i = 0; i < 2; i += 1)
        await week.saveCoachWeek(
          'coach-proposal',
          [request],
          emptyWeek,
          original,
          advance,
          '2026-10-08',
        );
      assert.equal(all("SELECT * FROM plan_constraints WHERE source = 'coach'").length, 1);
      assert.equal(
        all("SELECT * FROM plan_generations WHERE id = 'coach-proposal'")[0].trigger,
        'coach',
      );
      assert.equal(all('SELECT * FROM training_blocks WHERE closed_on IS NULL').length, 1);
      assert.equal((await blocks.getCurrentBlock()).state.index, original.state.index + 1);
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
      const id = await setRepo.logSet({
        workoutId: 'inside',
        exerciseId,
        exerciseOrder: 1,
        setIndex: 1,
        reps: 6,
        rir: 1,
        shortfall: 'doms',
      });
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
      const { plan, selection } = extraSession(exerciseId);
      const extraId = await workoutRepo.startExtraWorkout(plan, selection);
      await week.saveWeek(emptyWeek);
      const saved = await backup.dumpAll();
      const corrupted = structuredClone(saved);
      corrupted.tables.bands.push(corrupted.tables.bands[0]); // a duplicate key after the deletes
      await assert.rejects(backup.restoreAll(corrupted));
      assert.deepEqual(await backup.dumpAll(new Date(saved.exportedAt)), saved);
      await backup.restoreAll(saved);
      assert.equal(all('SELECT * FROM workouts').length, 2);
      const extra = (await workoutRepo.getWorkout(extraId)).plan;
      assert.deepEqual(
        [extra.kind, extra.source, extra.coachProposalId],
        ['extra', 'ai_accepted', 'extra-proposal'],
      );
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
