/* Activation against SQLite with FK enforcement enabled inside a transaction,
 * matching the production migrator. Cascading children must survive the rebuild. */
const {
  assert,
  current,
  schema,
  openDatabase,
  seeded,
  all,
  failInsert,
} = require('./sqlite-harness.cjs');
const sessions = require('../repositories/sessions.ts');
const workouts = require('../repositories/workouts.ts');
const backup = require('../repositories/backup.ts');
const { parseBackup } = require('../backup/parse.ts');
const { legalPlan, legalObservation } = require('../../domain/__tests__/planFixtures.ts');
const NOW = new Date('2026-10-09T08:00:00Z');
const children = [
  'set_logs',
  'set_log_revisions',
  'set_dispositions',
  'exposure_outcomes',
  'session_plan_revisions',
  'feel_reports',
  'cardio_logs',
];

function prepareActivation(native) {
  native.exec('PRAGMA foreign_keys = ON');
  native.exec("INSERT INTO exercises VALUES ('e', 'E', '{}', 1)");
  native.exec(
    "INSERT INTO workout_templates (id, name, blocks, sort_order) VALUES ('t', 'History title', '[]', 0)",
  );
  native.exec(
    "INSERT INTO workouts (id, training_date, started_at, status, template_id) VALUES ('old', '2026-09-01', '2026-09-01T08:00:00Z', 'in_progress', 't')",
  );
  native
    .prepare(
      "INSERT INTO workouts (id, training_date, started_at, status, plan_schema, plan_v2) VALUES ('live', '2026-10-09', '2026-10-09T08:00:00Z', 'in_progress', 2, ?)",
    )
    .run(JSON.stringify(legalPlan()));
  native.exec(
    "INSERT INTO set_logs (id, workout_id, exercise_id, exercise_order, set_index, reps, logged_at) VALUES ('s', 'old', 'e', 0, 1, 8, 'now')",
  );
  native.exec("INSERT INTO set_log_revisions VALUES ('s', 1, NULL, 'now')");
  native.exec(
    "INSERT INTO set_dispositions VALUES ('live', 'pending', 'skipped', 'pain', 'skip', 'now')",
  );
  native.exec(
    "INSERT INTO exposure_outcomes VALUES ('live', 'exposure', 'partial', 1, 1, 4, 1, 0, 3)",
  );
  native
    .prepare(
      "INSERT INTO session_plan_revisions VALUES ('live', 1, ?, 'start', 'engine', '[]', 'now')",
    )
    .run(JSON.stringify(legalPlan()));
  native.exec(
    "INSERT INTO feel_reports VALUES ('feel', 'live', NULL, 'too_hard', 'touch', 'feel-command', 'now')",
  );
  native.exec(
    "INSERT INTO cardio_logs (id, workout_id, training_date, purpose, minutes, logged_at) VALUES ('ride', 'old', '2026-09-01', 'warmup', 10, 'now')",
  );
  native.exec(
    "INSERT INTO legacy_sessions (id, training_date, started_at, status, sets, archived_at) VALUES ('archive', '2026-08-01', 'now', 'completed', '[]', 'now')",
  );
  native.exec(
    "INSERT INTO planned_days_v2 (date, status, generation_id, updated_at) VALUES ('2026-10-09', 'planned', 'g', 'now')",
  );
}

const CASES = [
  [
    'activation preserves every cascading child with FK enforcement enabled',
    async () => {
      let before;
      openDatabase({
        beforeMigration(file, native) {
          if (file !== '0014_activate_engine.sql') return;
          prepareActivation(native);
          before = children.map((table) => native.prepare('SELECT * FROM ' + table).all());
          native.exec('BEGIN');
        },
      });
      current.native.exec('COMMIT');
      assert.deepEqual(
        children.map((table) => all('SELECT * FROM ' + table)),
        before,
      );
      assert.deepEqual(all('PRAGMA foreign_key_check'), []);
      const old = await workouts.getWorkout('old');
      assert.equal(old.status, 'abandoned');
      assert.equal(old.finishedAt, old.startedAt);
      assert.deepEqual(old.plan, { regions: [], title: 'History title' });
      assert.equal((await workouts.findInProgressWorkout()).id, 'live');
      assert.equal((await workouts.getWorkout('live')).sessionPlan.sessionId, 's1');
      assert.equal(all('SELECT * FROM legacy_sessions').length, 1);
      assert.equal(all('SELECT * FROM planned_days').length, 1);
      assert.equal(
        all(
          "SELECT name FROM sqlite_master WHERE name IN ('planned_days_v2','plan_generations_v2','workout_templates','app_state')",
        ).length,
        0,
      );
      assert.equal(
        all('PRAGMA table_info(workouts)').some((c) => c.name === 'template_id'),
        false,
      );
      await require('../seed.ts').seedDatabase();
      const saved = await backup.dumpAll(NOW);
      await backup.restoreAll(saved);
      assert.deepEqual(await backup.dumpAll(NOW), saved);
    },
  ],
  [
    'a failed activation rolls back the parent and all its cascading children',
    async () => {
      let nativeDb;
      assert.throws(
        () =>
          openDatabase({
            beforeMigration(file, native) {
              if (file !== '0014_activate_engine.sql') return;
              nativeDb = native;
              prepareActivation(native);
              native.exec(
                "CREATE TRIGGER reject_restore BEFORE INSERT ON set_logs BEGIN SELECT RAISE(ABORT, 'restore failure'); END",
              );
              native.exec('BEGIN');
            },
          }),
        /restore failure/,
      );
      nativeDb.exec('ROLLBACK');
      assert.equal(
        nativeDb.prepare("SELECT status FROM workouts WHERE id = 'old'").get().status,
        'in_progress',
      );
      for (const table of children)
        assert.equal(nativeDb.prepare('SELECT count(*) AS n FROM ' + table).get().n, 1);
      assert.deepEqual(nativeDb.prepare('PRAGMA foreign_key_check').all(), []);
      nativeDb.close();
      current.native = null;
    },
  ],
  [
    'stale sessions close through commands and keep their real work',
    async () => {
      await seeded();
      assert.equal(
        sessions.startSession(
          { commandId: 'start', plan: legalPlan(), timeZone: 'Europe/Warsaw' },
          NOW,
        ).kind,
        'committed',
      );
      const plan = legalPlan();
      const set = plan.exposures[0].sets[0];
      const { plannedSetId: _id, ...observation } = legalObservation();
      assert.equal(
        sessions.logSet(
          {
            commandId: 'log',
            sessionId: 's1',
            plannedSetId: set.id,
            expectedSessionRevision: 1,
            observation,
          },
          NOW,
        ).kind,
        'committed',
      );
      current.db
        .insert(schema.plannedDays)
        .values({
          date: '2026-10-09',
          status: 'planned',
          generationId: 'g',
          updatedAt: NOW.toISOString(),
        })
        .run();
      await workouts.abandonStaleWorkouts(new Date(NOW.getTime() + 11 * 3600000));
      assert.equal((await workouts.getWorkout('s1')).status, 'in_progress');
      await workouts.abandonStaleWorkouts(new Date(NOW.getTime() + 13 * 3600000));
      assert.equal((await workouts.getWorkout('s1')).status, 'abandoned');
      assert.equal(all('SELECT * FROM set_logs').length, 1);
      assert.equal(all('SELECT status FROM planned_days')[0].status, 'missed');
      assert.equal(all("SELECT * FROM command_ledger WHERE kind = 'close_session'").length, 1);
      await workouts.abandonStaleWorkouts(new Date(NOW.getTime() + 14 * 3600000));
      assert.equal(all("SELECT * FROM command_ledger WHERE kind = 'close_session'").length, 1);
    },
  ],
  [
    'stale close failure preserves the running session and its week',
    async () => {
      await seeded();
      sessions.startSession(
        { commandId: 'start', plan: legalPlan(), timeZone: 'Europe/Warsaw' },
        NOW,
      );
      current.db
        .insert(schema.plannedDays)
        .values({
          date: '2026-10-09',
          status: 'planned',
          generationId: 'g',
          updatedAt: NOW.toISOString(),
        })
        .run();
      const drop = failInsert('reject_close', 'command_ledger', "WHEN NEW.kind = 'close_session'");
      // A failing store does not keep the app from starting: the session stays as it was.
      await workouts.abandonStaleWorkouts(new Date(NOW.getTime() + 13 * 3600000));
      drop();
      assert.equal((await workouts.getWorkout('s1')).status, 'in_progress');
      assert.equal(all('SELECT status FROM planned_days')[0].status, 'planned');
    },
  ],
  [
    'backup 7 restores historical sessions without resetting their sets',
    async () => {
      await seeded();
      const doc = await backup.dumpAll(NOW);
      doc.schemaVersion = 7;
      doc.tables.workout_templates = [
        {
          id: 't',
          name: 'Historical title',
          blocks: [],
          sortOrder: 0,
          warmupMinutes: null,
          isArchived: false,
        },
      ];
      doc.tables.workouts = [
        {
          id: 'old',
          trainingDate: '2026-09-01',
          startedAt: '2026-09-01T08:00:00Z',
          finishedAt: null,
          status: 'in_progress',
          templateId: 't',
          sessionRpe: null,
          notes: null,
          plan: null,
          planSchema: 1,
          planV2: null,
          planRevision: 1,
          revision: 0,
          timeZone: null,
        },
      ];
      const parsed = parseBackup(JSON.stringify(doc));
      assert.equal(parsed.ok, true, JSON.stringify(parsed));
      await backup.restoreAll(parsed.data);
      const restored = await workouts.getWorkout('old');
      assert.equal(restored.status, 'abandoned');
      assert.deepEqual(restored.plan, { regions: [], title: 'Historical title' });
      assert.equal(await workouts.findInProgressWorkout(), null);
    },
  ],
  [
    'a stale session no command can close is abandoned and does not stop the start (DAT-01)',
    async () => {
      await seeded();
      current.native
        .prepare(
          "INSERT INTO workouts (id, training_date, started_at, status, plan_schema, session_plan) VALUES ('planless', '2026-09-01', '2026-09-01T08:00:00Z', 'in_progress', 2, NULL)",
        )
        .run();
      await workouts.abandonStaleWorkouts(NOW);
      assert.equal((await workouts.getWorkout('planless')).status, 'abandoned');
      assert.equal(await workouts.findInProgressWorkout(), null);
    },
  ],
  [
    'a restored history raises every revision and gets its outcomes built again (DAT-04)',
    async () => {
      await seeded();
      sessions.startSession(
        { commandId: 'start', plan: legalPlan(), timeZone: 'Europe/Warsaw' },
        NOW,
      );
      const revisions = () =>
        Object.fromEntries(
          all('SELECT domain, revision FROM planning_revisions').map((r) => [r.domain, r.revision]),
        );
      const outcomes = all('SELECT * FROM exposure_outcomes').length;
      assert.ok(outcomes > 0, 'the running session has outcomes');
      const saved = await backup.dumpAll(NOW);
      const before = revisions();
      await backup.restoreAll(saved);
      const after = revisions();
      for (const domain of [
        'history',
        'profile',
        'catalog',
        'inventory',
        'requests',
        'block',
        'preferences',
      ]) {
        assert.ok(
          (after[domain] ?? 0) > (before[domain] ?? 0),
          domain + ' ' + JSON.stringify([before, after]),
        );
      }
      assert.equal(all('SELECT * FROM exposure_outcomes').length, outcomes);
    },
  ],
  [
    'a flaw in an older session does not shut off the changes of the running one (DAT-02)',
    async () => {
      await seeded();
      const { loadSessionChangeSource } = require('../repositories/sessionChangeSource.ts');
      sessions.startSession(
        { commandId: 'start', plan: legalPlan(), timeZone: 'Europe/Warsaw' },
        NOW,
      );
      const exercise = all('SELECT id FROM exercises LIMIT 1')[0].id;
      current.native
        .prepare(
          "INSERT INTO workouts (id, training_date, started_at, status, plan_schema, session_plan) VALUES ('older', '2026-09-01', '2026-09-01T08:00:00Z', 'completed', 2, ?)",
        )
        .run(JSON.stringify(legalPlan({ sessionId: 'older' })));
      current.native
        .prepare(
          "INSERT INTO set_logs (id, workout_id, exercise_id, exercise_order, set_index, reps, logged_at, planned_set_id, revision, observation) VALUES ('bad', 'older', ?, 0, 1, 8, 'now', 'nowhere', 1, ?)",
        )
        .run(
          exercise,
          JSON.stringify(
            legalObservation({ id: 'bad', sessionId: 'older', plannedSetId: 'nowhere' }),
          ),
        );
      const source = loadSessionChangeSource('s1');
      assert.deepEqual(source.problems, []);
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
