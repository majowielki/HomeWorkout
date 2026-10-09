/* Engine v2 storage on real SQLite (P2): the commands of a session — start, log, skip,
 * correct, undo, close — their idempotency, their rollback when the store fails, the
 * unique results, the history readers, and the backup round trip.
 * Same harness and same contract as sqlite-check.cjs: one RESULT line per case. */
const {
  assert,
  current,
  schema,
  openDatabase,
  all,
  exec,
  failInsert,
  seeded,
} = require('./sqlite-harness.cjs');
const sessions = require('../repositories/sessions.ts');
const history = require('../repositories/history.ts');
const backup = require('../repositories/backup.ts');
const setRepo = require('../repositories/setLogs.ts');
const coachSource = require('../repositories/coachSource.ts');
const calendar = require('../repositories/calendar.ts');
const { parseBackup } = require('../backup/parse.ts');
const {
  legalObservation,
  legalPlan,
  plannedSet,
} = require('../../domain/__tests__/planFixtures.ts');

const NOW = new Date('2026-10-09T08:00:00.000Z');
const at = (minutes) => new Date(NOW.getTime() + minutes * 60_000);
const SETS = ['s1/r1/e1/1L', 's1/r1/e1/1R', 's1/r1/e1/2L', 's1/r1/e1/2R'];

/** The command for a result confirmed as the plan said, as the logger would send it. */
function logCommand(commandId, plannedSetId, expectedSessionRevision, patch = {}) {
  const base = legalObservation();
  return {
    commandId,
    sessionId: 's1',
    plannedSetId,
    expectedSessionRevision,
    observation: {
      status: 'performed',
      amount: base.amount,
      resistance: base.resistance,
      rir: base.rir,
      shortfall: null,
      performedAt: NOW.toISOString(),
      ...patch,
    },
  };
}

/** The plan of the fixture, as the plan of session `sessionId` on `trainingDate`: every id carries its session. */
function planFor(sessionId, trainingDate = '2026-10-09') {
  const plan = legalPlan({ sessionId, trainingDate });
  const own = (text) => text.replace('s1/', sessionId + '/');
  plan.exposures = plan.exposures.map((e) => ({
    ...e,
    id: own(e.id),
    sets: e.sets.map((x) => ({
      ...x,
      id: own(x.id),
      logicalSetId: own(x.logicalSetId),
      comparisonGroupId: own(x.comparisonGroupId),
    })),
  }));
  plan.execution.steps = plan.execution.steps.map((st) => {
    if (st.kind === 'perform') return { ...st, plannedSetId: own(st.plannedSetId) };
    if (st.kind === 'rest') return { ...st, afterSetId: own(st.afterSetId) };
    return st;
  });
  return plan;
}

async function started(plan = legalPlan()) {
  await seeded();
  const result = sessions.startSession(
    { commandId: 'start-1', plan, timeZone: 'Europe/Warsaw' },
    NOW,
  );
  assert.equal(result.kind, 'committed');
  return result;
}

const rows = (table, where = '') => all(`SELECT * FROM ${table} ${where}`);
const workout = () => rows('workouts')[0];

const CASES = [
  [
    'starting a session freezes its plan, its first revision and the outcomes of its exposures',
    async () => {
      const result = await started();
      assert.deepEqual(result, {
        kind: 'committed',
        result: { sessionId: 's1' },
        sessionRevision: 1,
      });
      const w = workout();
      assert.deepEqual(
        [w.status, w.plan_schema, w.plan_revision, w.revision, w.time_zone, w.training_date],
        ['in_progress', 2, 1, 1, 'Europe/Warsaw', '2026-10-09'],
      );
      assert.equal(JSON.parse(w.session_plan).sessionId, 's1');
      assert.equal(rows('session_plan_revisions').length, 1);
      assert.deepEqual(
        { ...rows('exposure_outcomes')[0] },
        {
          workout_id: 's1',
          exposure_id: 's1/r1/e1',
          status: 'not_started',
          plan_revision: 1,
          history_revision: 1,
          expected: 4,
          performed: 0,
          interrupted: 0,
          skipped: 0,
        },
      );
    },
  ],
  [
    'the session as the screen reads it: the plan, what became of each set, and the results by planned set',
    async () => {
      assert.equal(sessions.readSessionState('nope'), null);
      await started();
      let state = sessions.readSessionState('s1');
      assert.deepEqual(
        [state.workout.status, state.workout.revision, state.workout.finishedAt],
        ['in_progress', 1, null],
      );
      assert.equal(state.plan.sessionId, 's1');
      assert.equal(state.states.size, 0);
      assert.equal(state.results.size, 0);

      const logged = sessions.logSet(logCommand('log-1', SETS[0], 1), at(1));
      assert.equal(logged.kind, 'committed');
      const skipped = sessions.skipSets(
        {
          commandId: 'skip-1',
          sessionId: 's1',
          plannedSetIds: [SETS[1]],
          expectedSessionRevision: logged.sessionRevision,
          reason: 'user_skipped',
        },
        at(2),
      );
      assert.equal(skipped.kind, 'committed');
      state = sessions.readSessionState('s1');
      assert.equal(state.states.get(SETS[0]), 'performed');
      assert.equal(state.states.get(SETS[1]), 'skipped');
      assert.deepEqual([...state.results.keys()], [SETS[0]]);
      assert.equal(state.results.get(SETS[0]).observation.status, 'performed');
      assert.equal(state.workout.revision, skipped.sessionRevision);
    },
  ],
  [
    'a skip can be taken back, and the sets are pending again; a result is never touched by it',
    async () => {
      await started();
      const skipped = sessions.skipSets(
        {
          commandId: 'skip-1',
          sessionId: 's1',
          plannedSetIds: [SETS[0], SETS[1]],
          reason: 'user_skipped',
          expectedSessionRevision: 1,
        },
        at(1),
      );
      assert.equal(skipped.kind, 'committed');
      const logged = sessions.logSet(logCommand('log-1', SETS[2], skipped.sessionRevision), at(2));
      assert.equal(logged.kind, 'committed');
      const reopened = sessions.reopenSets(
        { commandId: 'reopen-1', sessionId: 's1', plannedSetIds: [SETS[0], SETS[1], SETS[2]] },
        at(3),
      );
      assert.equal(reopened.kind, 'committed');
      assert.deepEqual(reopened.result, { reopened: [SETS[0], SETS[1], SETS[2]] });
      const state = sessions.readSessionState('s1');
      assert.equal(state.states.has(SETS[0]), false);
      assert.equal(state.states.has(SETS[1]), false);
      assert.equal(state.states.get(SETS[2]), 'performed');
      assert.equal(state.workout.revision, reopened.sessionRevision);
      // The same command twice reopens once; a finished session cannot be reopened.
      assert.equal(
        sessions.reopenSets(
          { commandId: 'reopen-1', sessionId: 's1', plannedSetIds: [SETS[0]] },
          at(4),
        ).kind,
        'already_committed',
      );
      sessions.closeSession({ commandId: 'close-1', sessionId: 's1', how: 'completed' }, at(5));
      assert.equal(
        sessions.reopenSets(
          { commandId: 'reopen-2', sessionId: 's1', plannedSetIds: [SETS[0]] },
          at(6),
        ).code,
        'SESSION_NOT_ACTIVE',
      );
    },
  ],
  [
    'T17 a second start while one session runs is a conflict, and the same start twice is one session',
    async () => {
      await started();
      const again = sessions.startSession(
        { commandId: 'start-1', plan: legalPlan(), timeZone: null },
        at(1),
      );
      assert.equal(again.kind, 'already_committed');
      const other = planFor('s2');
      const clash = sessions.startSession(
        { commandId: 'start-2', plan: other, timeZone: null },
        at(2),
      );
      assert.deepEqual(clash, {
        kind: 'conflict',
        code: 'ACTIVE_SESSION_EXISTS',
        actualRevision: null,
        detail: 's1',
      });
      assert.equal(rows('workouts').length, 1);
    },
  ],
  [
    'a plan that is not consistent is refused and writes nothing',
    async () => {
      await seeded();
      const broken = legalPlan();
      broken.execution.steps = broken.execution.steps.filter(
        (st) => !(st.kind === 'perform' && st.plannedSetId === SETS[3]),
      );
      const result = sessions.startSession({ commandId: 'bad', plan: broken, timeZone: null }, NOW);
      assert.equal(result.kind, 'rejected');
      assert.equal(result.code, 'INVALID_PLAN');
      assert.equal(rows('workouts').length, 0);
      assert.equal(rows('command_ledger').length, 0);
    },
  ],
  [
    'T15 a result is written once: the same command again answers from the ledger',
    async () => {
      await started();
      const first = sessions.logSet(logCommand('c1', SETS[0], 1), at(1));
      assert.deepEqual(first, {
        kind: 'committed',
        result: { observationId: 'obs-c1' },
        sessionRevision: 2,
      });
      const retry = sessions.logSet(logCommand('c1', SETS[0], 1), at(2));
      assert.deepEqual(retry, {
        kind: 'already_committed',
        result: { observationId: 'obs-c1' },
        sessionRevision: 2,
      });
      assert.equal(rows('set_logs').length, 1);
      assert.equal(workout().revision, 2);
      assert.equal(rows('planning_revisions').find((r) => r.domain === 'history').revision, 2);
      const set = rows('set_logs')[0];
      assert.deepEqual(
        [
          set.planned_set_id,
          set.exposure_id,
          set.role,
          set.progression_scope,
          set.source,
          set.performed_on,
          set.revision,
        ],
        [SETS[0], 's1/r1/e1', 'work', 'primary', 'plan', '2026-10-09', 1],
      );
      // History columns are projected from the observed result.
      assert.deepEqual(
        [
          set.exercise_id,
          set.reps,
          set.rir,
          set.weight_kg,
          set.dumbbell_mode,
          set.side,
          set.set_index,
          set.is_warmup,
        ],
        ['one-arm-db-row', 12, 2, 4, 'single', 'left', 1, 0],
      );
      assert.equal(JSON.parse(set.observation).amount.origin, 'user_confirmed');
      assert.equal(rows('exposure_outcomes')[0].performed, 1);
      assert.equal(rows('exposure_outcomes')[0].status, 'partial');
    },
  ],
  [
    'T15 a different command for a set that has a result is a conflict, not a second result',
    async () => {
      await started();
      sessions.logSet(logCommand('c1', SETS[0], 1), at(1));
      const second = sessions.logSet(logCommand('c2', SETS[0], 2), at(2));
      assert.equal(second.kind, 'conflict');
      assert.equal(second.code, 'SET_ALREADY_RECORDED');
      assert.equal(rows('set_logs').length, 1);
      assert.equal(workout().revision, 2);
    },
  ],
  [
    'a command made from an old state of the session is refused',
    async () => {
      await started();
      sessions.logSet(logCommand('c1', SETS[0], 1), at(1));
      const stale = sessions.logSet(logCommand('c2', SETS[1], 1), at(2));
      assert.deepEqual(stale, { kind: 'conflict', code: 'SESSION_CHANGED', actualRevision: 2 });
      assert.equal(rows('set_logs').length, 1);
      assert.equal(sessions.logSet(logCommand('c3', SETS[1], 2), at(3)).kind, 'committed');
    },
  ],
  [
    'T15 a store that fails mid-write leaves nothing behind, and the retry of the same command writes it once',
    async () => {
      await started();
      const before = {
        sets: rows('set_logs').length,
        revision: workout().revision,
        ledger: rows('command_ledger').length,
      };
      for (const table of ['command_ledger', 'exposure_outcomes', 'set_logs']) {
        const drop = failInsert(`fail_${table}`, table);
        const result = sessions.logSet(logCommand('c1', SETS[0], 1), at(1));
        assert.equal(result.kind, 'storage_error', table);
        assert.equal(result.retryable, true);
        assert.equal(result.commandId, 'c1');
        assert.deepEqual(
          {
            sets: rows('set_logs').length,
            revision: workout().revision,
            ledger: rows('command_ledger').length,
          },
          before,
          table,
        );
        assert.equal(rows('exposure_outcomes')[0].performed, 0, table);
        drop();
      }
      const retried = sessions.logSet(logCommand('c1', SETS[0], 1), at(2));
      assert.equal(retried.kind, 'committed');
      assert.equal(rows('set_logs').length, 1);
    },
  ],
  [
    'a result for a set that is not in the plan, or that is wrong in itself, is refused and writes nothing',
    async () => {
      await started();
      const ghost = sessions.logSet(logCommand('g', 's1/r1/e1/9', 1), at(1));
      assert.equal(ghost.code, 'UNKNOWN_PLANNED_SET');
      const base = legalObservation();
      const contradiction = sessions.logSet(
        logCommand('x', SETS[0], 1, { rir: { ...base.rir, origin: 'user_reported' } }),
        at(2),
      );
      assert.equal(contradiction.code, 'INVALID_COMMAND');
      const nothing = sessions.logSet(
        logCommand('n', SETS[0], 1, {
          amount: { ...base.amount, value: { kind: 'reps', reps: 0 } },
        }),
        at(3),
      );
      assert.equal(nothing.code, 'INVALID_COMMAND');
      const unknownSession = sessions.logSet(
        { ...logCommand('u', SETS[0], 1), sessionId: 'nope' },
        at(4),
      );
      assert.equal(unknownSession.code, 'UNKNOWN_SESSION');
      assert.equal(sessions.logSet({ ...logCommand('e', null, 1) }, at(5)).code, 'INVALID_COMMAND');
      assert.equal(rows('set_logs').length, 0);
      assert.equal(workout().revision, 1);
    },
  ],
  [
    'T18 an undone result stays as a tombstone: its command cannot bring it back, and the set can be done again',
    async () => {
      await started();
      sessions.logSet(logCommand('c1', SETS[0], 1), at(1));
      const undone = sessions.undoSet(
        { commandId: 'u1', sessionId: 's1', observationId: 'obs-c1' },
        at(2),
      );
      assert.equal(undone.kind, 'committed');
      assert.deepEqual(undone.result, { observationId: 'obs-c1', plannedSetId: SETS[0] });
      const tomb = rows('set_logs')[0];
      assert.ok(tomb.deleted_at);
      assert.equal(tomb.revision, 2);
      assert.equal(rows('set_log_revisions').length, 1);
      assert.equal(rows('exposure_outcomes')[0].performed, 0);

      const replay = sessions.logSet(logCommand('c1', SETS[0], 1), at(3));
      assert.equal(replay.kind, 'conflict');
      assert.equal(replay.code, 'COMMAND_SUPERSEDED');
      assert.equal(rows('set_logs').length, 1);

      const again = sessions.logSet(logCommand('c2', SETS[0], 3), at(4));
      assert.equal(again.kind, 'committed');
      assert.equal(rows('set_logs').length, 2);
      assert.equal(rows('set_logs', 'WHERE deleted_at IS NULL').length, 1);
      assert.equal(
        sessions.undoSet({ commandId: 'u2', sessionId: 's1', observationId: 'obs-c1' }, at(5)).code,
        'UNKNOWN_OBSERVATION',
      );
      const same = sessions.undoSet(
        { commandId: 'u1', sessionId: 's1', observationId: 'obs-c1' },
        at(6),
      );
      assert.equal(same.kind, 'already_committed');
    },
  ],
  [
    'a correction keeps what it replaces, moves the columns, and refuses a stale one',
    async () => {
      await started();
      sessions.logSet(logCommand('c1', SETS[0], 1), at(1));
      const base = legalObservation();
      const patch = {
        amount: {
          ...base.amount,
          value: { kind: 'reps', reps: 10 },
          origin: 'user_reported',
          presentedDefault: false,
          confirmation: 'edited',
        },
      };
      const fixed = sessions.updateSet(
        {
          commandId: 'f1',
          sessionId: 's1',
          observationId: 'obs-c1',
          expectedObservationRevision: 1,
          patch,
        },
        at(2),
      );
      assert.deepEqual(fixed.result, { observationId: 'obs-c1', revision: 2 });
      const row = rows('set_logs')[0];
      assert.deepEqual([row.reps, row.revision], [10, 2]);
      assert.equal(JSON.parse(rows('set_log_revisions')[0].payload).amount.value.reps, 12);
      assert.equal(JSON.parse(row.observation).revision, 2);
      const stale = sessions.updateSet(
        {
          commandId: 'f2',
          sessionId: 's1',
          observationId: 'obs-c1',
          expectedObservationRevision: 1,
          patch,
        },
        at(3),
      );
      assert.equal(stale.code, 'STALE_INPUT');
      const bad = sessions.updateSet(
        {
          commandId: 'f3',
          sessionId: 's1',
          observationId: 'obs-c1',
          expectedObservationRevision: 2,
          patch: { rir: { ...base.rir, origin: 'measured' } },
        },
        at(4),
      );
      assert.equal(bad.code, 'INVALID_COMMAND');
      assert.equal(
        sessions.updateSet(
          {
            commandId: 'f4',
            sessionId: 's1',
            observationId: 'nope',
            expectedObservationRevision: 1,
            patch,
          },
          at(5),
        ).code,
        'UNKNOWN_OBSERVATION',
      );
      assert.equal(rows('set_log_revisions').length, 1);
    },
  ],
  [
    'T12 a skip is stored with its reason, survives a re-read, gives way to a result, and cannot hide one',
    async () => {
      await started();
      const skipped = sessions.skipSets(
        {
          commandId: 'k1',
          sessionId: 's1',
          plannedSetIds: [SETS[2], SETS[3]],
          reason: 'time',
          expectedSessionRevision: 1,
        },
        at(1),
      );
      assert.deepEqual(skipped.result, { skipped: [SETS[2], SETS[3]] });
      assert.deepEqual(
        rows('set_dispositions').map((d) => [d.planned_set_id, d.status, d.reason]),
        [
          [SETS[2], 'skipped', 'time'],
          [SETS[3], 'skipped', 'time'],
        ],
      );
      assert.equal(rows('set_logs').length, 0);
      assert.equal(rows('exposure_outcomes')[0].skipped, 2);
      // The person does one of them after all.
      sessions.logSet(logCommand('c1', SETS[2], 2), at(2));
      assert.deepEqual(
        rows('set_dispositions').map((d) => d.planned_set_id),
        [SETS[3]],
      );
      // A set that has a result cannot be skipped.
      const clash = sessions.skipSets(
        {
          commandId: 'k2',
          sessionId: 's1',
          plannedSetIds: [SETS[2]],
          reason: 'time',
          expectedSessionRevision: 3,
        },
        at(3),
      );
      assert.equal(clash.code, 'SET_ALREADY_RECORDED');
      assert.equal(
        sessions.skipSets(
          {
            commandId: 'k3',
            sessionId: 's1',
            plannedSetIds: ['s1/r1/e1/9'],
            reason: 'time',
            expectedSessionRevision: 3,
          },
          at(4),
        ).code,
        'UNKNOWN_PLANNED_SET',
      );
      assert.equal(
        sessions.skipSets(
          {
            commandId: 'k4',
            sessionId: 's1',
            plannedSetIds: [],
            reason: 'time',
            expectedSessionRevision: 3,
          },
          at(4),
        ).code,
        'UNKNOWN_PLANNED_SET',
      );
      assert.equal(
        sessions.skipSets(
          {
            commandId: 'k5',
            sessionId: 's1',
            plannedSetIds: [SETS[0]],
            reason: 'time',
            expectedSessionRevision: 1,
          },
          at(5),
        ).code,
        'SESSION_CHANGED',
      );
    },
  ],
  [
    'T13 closing a session with sets undone writes nothing for them; the outcomes read them as skipped',
    async () => {
      await started();
      sessions.logSet(logCommand('c1', SETS[0], 1), at(1));
      const closed = sessions.closeSession(
        { commandId: 'end', sessionId: 's1', how: 'completed', sessionRpe: 7, notes: 'ok' },
        at(30),
      );
      assert.equal(closed.kind, 'committed');
      assert.equal(closed.result.status, 'completed');
      assert.deepEqual(
        closed.result.outcomes.map((o) => [o.status, o.expected, o.performed, o.skipped]),
        [['partial', 4, 1, 3]],
      );
      assert.equal(rows('set_logs').length, 1);
      assert.equal(rows('set_dispositions').length, 0);
      const w = workout();
      assert.deepEqual(
        [w.status, w.session_rpe, w.notes, w.finished_at],
        ['completed', 7, 'ok', at(30).toISOString()],
      );
      // Nothing more can be recorded in it, and closing it again is refused.
      assert.equal(
        sessions.logSet(logCommand('c2', SETS[1], w.revision), at(31)).code,
        'SESSION_NOT_ACTIVE',
      );
      assert.equal(
        sessions.closeSession({ commandId: 'end2', sessionId: 's1', how: 'abandoned' }, at(32))
          .code,
        'SESSION_NOT_ACTIVE',
      );
      assert.equal(
        sessions.closeSession({ commandId: 'end', sessionId: 's1', how: 'completed' }, at(33)).kind,
        'already_committed',
      );
    },
  ],
  [
    'T14 an abandoned session keeps its work and is not a failure: the history reads it, marked',
    async () => {
      await started();
      sessions.logSet(logCommand('c1', SETS[0], 1), at(1));
      sessions.closeSession({ commandId: 'end', sessionId: 's1', how: 'abandoned' }, at(10));
      assert.equal(workout().status, 'abandoned');
      const loaded = await history.loadWindow('2026-10-01');
      assert.equal(loaded.records.length, 1);
      assert.equal(loaded.records[0].context.abandoned, true);
      assert.equal(loaded.records[0].sets.filter((s) => s.observation).length, 1);
      assert.deepEqual(loaded.problems, []);
    },
  ],
  [
    'a correction is allowed after the session ended: history can be fixed',
    async () => {
      await started();
      sessions.logSet(logCommand('c1', SETS[0], 1), at(1));
      sessions.closeSession({ commandId: 'end', sessionId: 's1', how: 'completed' }, at(10));
      const base = legalObservation();
      const fixed = sessions.updateSet(
        {
          commandId: 'f1',
          sessionId: 's1',
          observationId: 'obs-c1',
          expectedObservationRevision: 1,
          patch: { shortfall: 'doms', rir: { ...base.rir, value: 1 } },
        },
        at(11),
      );
      assert.equal(fixed.kind, 'committed');
      assert.equal(rows('set_logs')[0].shortfall, 'doms');
    },
  ],
  [
    'feel is recorded once per command and only for an exposure of the session',
    async () => {
      await started();
      const felt = sessions.recordFeel(
        {
          commandId: 'f1',
          sessionId: 's1',
          exposureId: 's1/r1/e1',
          feel: 'too_hard',
          channel: 'voice',
        },
        at(1),
      );
      assert.equal(felt.kind, 'committed');
      assert.equal(
        sessions.recordFeel(
          {
            commandId: 'f1',
            sessionId: 's1',
            exposureId: 's1/r1/e1',
            feel: 'too_hard',
            channel: 'voice',
          },
          at(2),
        ).kind,
        'already_committed',
      );
      assert.equal(rows('feel_reports').length, 1);
      assert.equal(
        sessions.recordFeel(
          {
            commandId: 'f2',
            sessionId: 's1',
            exposureId: 'nope',
            feel: 'too_easy',
            channel: 'touch',
          },
          at(3),
        ).code,
        'INVALID_COMMAND',
      );
      const loaded = await history.loadWindow('2026-10-01');
      assert.equal(loaded.records[0].context.feel, 'too_hard');
    },
  ],
  [
    'a set beyond the plan is recorded as work, with its exercise, and is no evidence for the plan',
    async () => {
      await started();
      const result = sessions.logSet(
        {
          ...logCommand('x1', null, 1),
          extra: { exerciseId: 'one-arm-db-row', exposureId: 's1/r1/e1', source: 'user_override' },
        },
        at(1),
      );
      assert.equal(result.kind, 'committed');
      const row = rows('set_logs')[0];
      assert.deepEqual(
        [row.planned_set_id, row.exposure_id, row.source, row.exercise_id],
        [null, 's1/r1/e1', 'user_override', 'one-arm-db-row'],
      );
      const loaded = await history.loadWindow('2026-10-01');
      assert.equal(loaded.records[0].extra.length, 1);
      assert.equal(loaded.records[0].sets.filter((s) => s.observation).length, 0);
    },
  ],
  [
    'the wear of a band counts once for each new result, never for a retry',
    async () => {
      const plan = legalPlan();
      const bandSpec = {
        schemaVersion: 1,
        modelId: 'band.long',
        equipmentInstanceIds: ['band:red'],
        configurationKey: '',
        value: {
          kind: 'band_position',
          bandId: 'red',
          positionId: 'P1',
          geometryRevision: 'anchor-30cm-v1',
        },
      };
      plan.exposures[0].sets = plan.exposures[0].sets.map((s) => ({ ...s, resistance: bandSpec }));
      await started(plan);
      const base = legalObservation();
      const command = logCommand('b1', SETS[0], 1, {
        resistance: { ...base.resistance, value: bandSpec },
      });
      sessions.logSet(command, at(1));
      sessions.logSet(command, at(2));
      assert.equal(rows('bands', "WHERE id = 'red'")[0].cycle_count, 12);
      assert.deepEqual(
        [
          rows('set_logs')[0].band_id,
          rows('set_logs')[0].anchor_position,
          rows('set_logs')[0].weight_kg,
        ],
        ['red', 1, null],
      );
    },
  ],
  [
    'taking a band result back or correcting it takes its wear off again (DAT-06)',
    async () => {
      const plan = legalPlan();
      const bandSpec = {
        schemaVersion: 1,
        modelId: 'band.long',
        equipmentInstanceIds: ['band:red'],
        configurationKey: '',
        value: {
          kind: 'band_position',
          bandId: 'red',
          positionId: 'P1',
          geometryRevision: 'anchor-30cm-v1',
        },
      };
      plan.exposures[0].sets = plan.exposures[0].sets.map((s) => ({ ...s, resistance: bandSpec }));
      await started(plan);
      const base = legalObservation();
      const wear = () => rows('bands', "WHERE id = 'red'")[0].cycle_count;
      const logged = sessions.logSet(
        logCommand('w1', SETS[0], 1, { resistance: { ...base.resistance, value: bandSpec } }),
        at(1),
      );
      assert.equal(logged.kind, 'committed');
      assert.equal(wear(), 12);
      const corrected = sessions.updateSet(
        {
          commandId: 'w-fix',
          sessionId: 's1',
          observationId: 'obs-w1',
          expectedObservationRevision: 1,
          patch: { amount: { ...base.amount, value: { kind: 'reps', reps: 14 } } },
        },
        at(2),
      );
      assert.equal(corrected.kind, 'committed', JSON.stringify(corrected));
      assert.equal(wear(), 14);
      sessions.undoSet({ commandId: 'w-undo', sessionId: 's1', observationId: 'obs-w1' }, at(3));
      assert.equal(wear(), 0);
    },
  ],
  [
    'a result taken back is no set to any of historical sessions’s readers',
    async () => {
      await started();
      sessions.logSet(logCommand('c1', SETS[0], 1), at(1));
      sessions.logSet(logCommand('c2', SETS[1], 2), at(2));
      sessions.undoSet({ commandId: 'u1', sessionId: 's1', observationId: 'obs-c1' }, at(3));
      sessions.closeSession({ commandId: 'end', sessionId: 's1', how: 'completed' }, at(10));
      assert.deepEqual(
        (await setRepo.getSetsForWorkout('s1')).map((r) => r.id),
        ['obs-c2'],
      );
      const state = sessions.readSessionState('s1');
      assert.equal(state.results.size, 1);
      assert.equal(state.results.get(SETS[1]).id, 'obs-c2');
      const { listWorkouts } = require('../repositories/workouts.ts');
      assert.equal((await listWorkouts()).find((w) => w.id === 's1').workingSets, 1);
      const coach = await coachSource.loadCoachSource(new Date('2026-10-10T12:00:00Z'));
      assert.deepEqual(
        coach.sets.map((x) => x.id),
        ['obs-c2'],
      );
      const month = await calendar.getCalendarRange('2026-10-01', '2026-10-31');
      assert.equal(month.sessions[0].sets, 1);
    },
  ],
  [
    'SQLite itself keeps a command, a live result of a set and a skip of a set to one',
    async () => {
      await started();
      sessions.logSet(logCommand('c1', SETS[0], 1), at(1));
      const insert = (id, command, planned, deleted = null) =>
        current.native
          .prepare(
            `INSERT INTO set_logs (id, workout_id, exercise_id, exercise_order, set_index, is_warmup, logged_at, command_id, planned_set_id, deleted_at, revision) VALUES (?, 's1', 'one-arm-db-row', 0, 1, 0, 'x', ?, ?, ?, 1)`,
          )
          .run(id, command, planned, deleted);
      assert.throws(() => insert('dup-command', 'c1', null), /UNIQUE/);
      assert.throws(() => insert('dup-set', 'other', SETS[0]), /UNIQUE/);
      insert('tomb', 'tomb-command', SETS[0], 'when');
      insert('plain-1', null, null);
      insert('plain-2', null, null);
      assert.throws(
        () =>
          exec(
            "INSERT INTO set_dispositions VALUES ('s1', 's1/r1/e1/2R', 'skipped', NULL, 'k', 'x'), ('s1', 's1/r1/e1/2R', 'skipped', NULL, 'k', 'x')",
          ),
        /UNIQUE|PRIMARY/,
      );
    },
  ],
  [
    'T34 an exercise that comes back after months is found by its key, however old the result',
    async () => {
      await seeded();
      let when = 0;
      const run = (sessionId, date) => {
        const began = sessions.startSession(
          { commandId: `start-${sessionId}`, plan: planFor(sessionId, date), timeZone: null },
          at((when += 1)),
        );
        assert.equal(began.kind, 'committed', JSON.stringify(began));
        const logged = sessions.logSet(
          { ...logCommand(`log-${sessionId}`, `${sessionId}/r1/e1/1L`, 1), sessionId },
          at((when += 1)),
        );
        assert.equal(logged.kind, 'committed', JSON.stringify(logged));
        const ended = sessions.closeSession(
          { commandId: `end-${sessionId}`, sessionId, how: 'completed' },
          at((when += 1)),
        );
        assert.equal(ended.kind, 'committed', JSON.stringify(ended));
      };
      run('s1', '2026-01-10');
      run('s2', '2026-03-02');
      run('s3', '2026-10-05');
      // A window of the last 120 days from 2026-10-09 starts in June: only s3 is inside it.
      const planning = await history.loadHistoryForPlanning('2026-06-11');
      assert.deepEqual(
        planning.records.map((r) => r.sessionId),
        ['s3'],
      );
      assert.deepEqual(
        planning.older.map((r) => [r.sessionId, r.trainingDate]),
        [['s2', '2026-03-02']],
      );
      const none = await history.loadLastComparableBefore('2026-01-01');
      assert.deepEqual(none, []);
    },
  ],
  [
    'migration 0010 keeps sessions and sets of historical sessions as they were, with no engine data',
    async () => {
      openDatabase({
        beforeMigration(file, native) {
          if (file === '0010_engine_v2_storage.sql') {
            native.exec("INSERT INTO exercises VALUES ('e', 'E', '{}', 1)");
            native.exec(
              "INSERT INTO workouts (id, training_date, started_at, status) VALUES ('old', '2026-09-01', 'x', 'completed')",
            );
            native.exec(
              "INSERT INTO set_logs (id, workout_id, exercise_id, exercise_order, set_index, is_warmup, reps, logged_at) VALUES ('s', 'old', 'e', 0, 1, 0, 8, 'x')",
            );
          }
        },
      });
      const w = rows('workouts')[0];
      assert.deepEqual(
        [w.plan_schema, w.plan_revision, w.revision, w.session_plan, w.time_zone],
        [1, 1, 0, null, null],
      );
      const s = rows('set_logs')[0];
      assert.deepEqual(
        [s.revision, s.command_id, s.planned_set_id, s.deleted_at, s.observation, s.performed_on],
        [1, null, null, null, null, null],
      );
      assert.equal(rows('set_logs')[0].reps, 8);
    },
  ],
  [
    'T53 a backup of engine data restores it whole, and a corrupt one changes nothing',
    async () => {
      await started();
      sessions.logSet(logCommand('c1', SETS[0], 1), at(1));
      sessions.updateSet(
        {
          commandId: 'f1',
          sessionId: 's1',
          observationId: 'obs-c1',
          expectedObservationRevision: 1,
          patch: { shortfall: 'doms' },
        },
        at(2),
      );
      sessions.skipSets(
        {
          commandId: 'k1',
          sessionId: 's1',
          plannedSetIds: [SETS[3]],
          reason: 'pain',
          expectedSessionRevision: 3,
        },
        at(3),
      );
      sessions.recordFeel(
        { commandId: 'fl', sessionId: 's1', exposureId: null, feel: 'too_easy', channel: 'touch' },
        at(4),
      );
      sessions.closeSession({ commandId: 'end', sessionId: 's1', how: 'completed' }, at(5));
      const saved = await backup.dumpAll(NOW);
      const parsed = parseBackup(JSON.stringify(saved));
      assert.equal(parsed.ok, true, JSON.stringify(parsed));
      assert.equal(saved.tables.set_log_revisions.length, 1);
      assert.equal(saved.tables.set_dispositions.length, 1);
      assert.equal(saved.tables.session_plan_revisions.length, 1);
      assert.equal(saved.tables.feel_reports.length, 1);

      const corrupted = structuredClone(saved);
      corrupted.tables.bands.push(corrupted.tables.bands[0]);
      await assert.rejects(backup.restoreAll(corrupted));
      assert.deepEqual(await backup.dumpAll(NOW), saved);

      exec('DELETE FROM command_ledger');
      await backup.restoreAll(parsed.data);
      assert.deepEqual(await backup.dumpAll(NOW), saved);
      // The commands of the replaced history mean nothing to the restored one.
      assert.equal(rows('command_ledger').length, 0);
      assert.equal(rows('workouts')[0].plan_schema, 2);
    },
  ],
  [
    'a command id of another kind or another session is refused, not answered as a repeat (DAT-03)',
    async () => {
      await seeded();
      sessions.startSession({ commandId: 'start', plan: legalPlan(), timeZone: null }, NOW);
      const skip = (commandId, sessionId = 's1') =>
        sessions.skipSets(
          {
            commandId,
            sessionId,
            plannedSetIds: [SETS[0]],
            reason: 'user_skipped',
            expectedSessionRevision: 1,
          },
          at(1),
        );
      const wrongKind = skip('start');
      assert.equal(wrongKind.kind, 'rejected', JSON.stringify(wrongKind));
      assert.equal(wrongKind.code, 'INVALID_COMMAND');
      assert.equal(all('SELECT * FROM set_dispositions').length, 0);
      // The same kind for the same session is a repeat; for another session it is a mistake.
      assert.equal(skip('skip-1').kind, 'committed');
      assert.equal(skip('skip-1').kind, 'already_committed');
      assert.equal(skip('skip-1', 'elsewhere').kind, 'rejected');
      // A start repeated with its own id still answers with the stored session.
      assert.equal(
        sessions.startSession({ commandId: 'start', plan: legalPlan(), timeZone: null }, at(2))
          .kind,
        'already_committed',
      );
    },
  ],
  [
    'a set beyond the plan must belong to an exposure of it (ENG-08)',
    async () => {
      await started();
      const base = legalObservation();
      const extra = (exposureId, commandId) =>
        sessions.logSet(
          {
            commandId,
            sessionId: 's1',
            plannedSetId: null,
            extra: { exerciseId: 'one-arm-db-row', exposureId, source: 'extra' },
            expectedSessionRevision: 1,
            observation: {
              status: 'performed',
              amount: base.amount,
              resistance: base.resistance,
              rir: base.rir,
              shortfall: null,
              performedAt: NOW.toISOString(),
            },
          },
          at(1),
        );
      const orphan = extra(null, 'x-null');
      assert.equal(orphan.kind, 'rejected', JSON.stringify(orphan));
      assert.equal(extra('s1/r1/nowhere', 'x-none').kind, 'rejected');
      assert.equal(rows('set_logs').length, 0);
      assert.equal(extra('s1/r1/e1', 'x-ok').kind, 'committed');
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

void schema;
void plannedSet;
