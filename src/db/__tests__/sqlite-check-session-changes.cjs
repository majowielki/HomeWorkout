/* P4b.4 T68/T69: real SQLite, production transaction/ledger and fresh domain re-assessment. */
const { assert, current, all, exec, seeded, failInsert } = require('./sqlite-harness.cjs');
const application = require('../../app-services/commands/applySessionChange.ts');
const feelApplication = require('../../app-services/commands/reportSessionFeel.ts');
const { reportSessionFeel } = require('../repositories/sessionFeel.ts');
const { applySessionChange } = require('../repositories/sessionChanges.ts');
const { loadSessionChangeSource } = application;
const sessions = require('../repositories/sessionsV2.ts');
const history = require('../repositories/historyV2.ts');
const { assessSessionChange } = require('../../domain/session/assess.ts');
const { adviceToAcknowledge } = require('../../domain/policy/hardAdvice.ts');
const { world, recipe } = require('../../domain/__tests__/sessionChangeFixtures.ts');
const { qualifyExposure } = require('../../domain/observations/qualify.ts');
const { legalObservation } = require('../../domain/__tests__/planV2Fixtures.ts');
const { auditPlan } = require('../../domain/plan/audit.ts');
const { modelFor } = require('../../domain/plan/resistanceOf.ts');
const NOW = new Date('2026-10-05T09:00:00Z');
const add = (id = 'crunch', sets = 1) => ({ kind: 'add_exercise', exercise: { id }, sets });

async function started(specs = []) {
  await seeded();
  const { session } = world(specs);
  assert.equal(
    sessions.startSessionV2(
      { commandId: 'start', plan: session.plan, timeZone: 'Europe/Warsaw' },
      NOW,
    ).kind,
    'committed',
  );
  return loadSessionChangeSource('s1');
}
function preview(change = add(), commandId = 'apply') {
  const source = loadSessionChangeSource('s1');
  const assessment = assessSessionChange(source.snap, source.session, change, {
    maxAlternatives: 0,
  });
  return {
    source,
    assessment,
    cmd: {
      commandId,
      sessionId: 's1',
      patchId: assessment.patch?.patchId ?? '0'.repeat(64),
      change,
      expected: {
        planRevision: source.session.plan.planRevision,
        historyRevision: source.snap.historyRevision,
      },
      acknowledged: adviceToAcknowledge(assessment.checks),
      channel: 'touch',
    },
  };
}
function snapshot() {
  return Object.fromEntries(
    [
      'workouts',
      'set_logs',
      'set_dispositions',
      'session_plan_revisions',
      'command_ledger',
      'planning_revisions',
      'exposure_outcomes',
      'feel_reports',
    ].map((table) => [table, all(`SELECT * FROM ${table}`)]),
  );
}
function logFirst(source, ordinal = 0) {
  const set = source.session.plan.exposures[0].sets[ordinal];
  const base = legalObservation();
  const r = sessions.logSetV2(
    {
      commandId: 'log' + ordinal,
      sessionId: 's1',
      plannedSetId: set.id,
      expectedSessionRevision: all("SELECT revision FROM workouts WHERE id = 's1'")[0].revision,
      observation: {
        status: 'performed',
        amount: { ...base.amount, value: { kind: 'reps', reps: 10 } },
        resistance: { ...base.resistance, value: set.resistance },
        rir: { ...base.rir, value: 2 },
        shortfall: null,
        performedAt: NOW.toISOString(),
      },
    },
    NOW,
  );
  assert.equal(r.kind, 'committed');
}

function feelCommand(feel = 'too_hard', commandId = 'report', exposureId) {
  const source = loadSessionChangeSource('s1');
  return {
    commandId,
    sessionId: 's1',
    exposureId: exposureId === undefined ? source.session.plan.exposures[0].id : exposureId,
    feel,
    channel: 'voice',
    expected: {
      planRevision: source.session.plan.planRevision,
      historyRevision: source.snap.historyRevision,
    },
  };
}

function acceptFeelOption(
  option,
  basedOn,
  commandId = 'choice',
  acknowledged = adviceToAcknowledge(option.assessment.checks),
) {
  return applySessionChange(
    {
      commandId,
      sessionId: 's1',
      change: option.change,
      patchId: option.assessment.patch.patchId,
      expected: { planRevision: basedOn.planRevision, historyRevision: basedOn.historyRevision },
      acknowledged,
      channel: 'voice',
    },
    NOW,
  );
}

const CASES = [
  [
    'P4b.5 T72 touch, voice and AI return the identical offline ChangeAssessment',
    async () => {
      let reference;
      for (const channel of ['touch', 'voice', 'ai_proposal']) {
        const source = await started([recipe('db-floor-press', 3)]);
        logFirst(source);
        const r = reportSessionFeel({ ...feelCommand(), channel }, NOW);
        assert.equal(r.kind, 'committed');
        if (reference) assert.deepEqual(r.result.assessment, reference);
        else reference = r.result.assessment;
      }
    },
  ],
  [
    'P4b.5 report writes FeelReport and returns assessed options without revising the plan',
    async () => {
      await started([recipe('db-floor-press', 3)]);
      const cmd = feelCommand();
      const before = snapshot();
      const promised = feelApplication.reportSessionFeel(cmd, NOW);
      assert(promised instanceof Promise);
      const result = await promised;
      assert.equal(result.kind, 'committed');
      assert.equal(result.result.assessment.patch, null);
      assert.equal(result.result.assessment.feel.options.length, 3);
      const source = loadSessionChangeSource('s1');
      assert.equal(source.session.records[0].context.feel, 'too_hard');
      assert.equal(source.snap.historyRevision, cmd.expected.historyRevision + 1);
      assert.equal(result.result.assessment.basedOn.historyRevision, source.snap.historyRevision);
      assert.deepEqual(source.session.plan, JSON.parse(before.workouts[0].plan_v2));
      assert.deepEqual(all('SELECT * FROM session_plan_revisions'), before.session_plan_revisions);
      assert.equal(all('SELECT * FROM set_logs').length, 0);
      assert.equal(all('SELECT * FROM set_dispositions').length, 0);
      const saved = all('SELECT * FROM feel_reports')[0];
      assert.equal(saved.channel, 'voice');
      assert.equal(saved.at, NOW.toISOString());
      const committed = snapshot();
      assert.deepEqual(reportSessionFeel(cmd, NOW), { ...result, kind: 'already_committed' });
      assert.deepEqual(snapshot(), committed);
    },
  ],
  ...['touch', 'voice', 'ai_proposal'].map((channel) => [
    `P4b.5 ${channel}: T71 lighter option accepts unchanged after the report and preserves progression evidence`,
    async () => {
      const source = await started([recipe('db-floor-press', 3)]);
      logFirst(source);
      const cmd = { ...feelCommand(), channel };
      const r = reportSessionFeel(cmd, NOW);
      assert.equal(r.kind, 'committed');
      const a = r.result.assessment;
      const choice = a.feel.options.find((o) => a.feel.recommendedOptionIds.includes(o.id));
      assert.equal(choice.why, 'easier_resistance');
      const actual = all('SELECT * FROM set_logs');
      assert.equal(acceptFeelOption(choice, a.basedOn).kind, 'committed');
      assert.deepEqual(all('SELECT * FROM set_logs'), actual);
      const loaded = await history.loadWindow('2026-10-01');
      assert.equal(loaded.problems.length, 0);
      assert(loaded.records.every((record) => record.context.userReduced));
      const original = loaded.records.find((record) => record.exposureId === cmd.exposureId);
      const evidence = qualifyExposure(
        original,
        { dropOffAllowance: 2 },
        modelFor(original.sets[0].planned.resistance),
      );
      assert(evidence.reasons.includes('USER_REDUCED'));
      assert.equal(evidence.performance, 'not_evaluable');
      const { prescribeNext } = require('../../domain/progression/next.ts');
      const { draft } = prescribeNext({
        exerciseId: original.exerciseId,
        unit: 'reps',
        model: modelFor(original.sets[0].planned.resistance),
        start: original.sets[0].planned.resistance,
        range: { lo: 8, hi: 15 },
        targetRir: { min: 2, max: 3 },
        repCap: 25,
        history: [original],
        asOf: '2026-10-07',
        layoff: { tier: 'none', gapDays: 2, recalibrating: false },
        phase: 'work',
        eligible: true,
        sets: { recommended: 3, allowed: [1, 3], advisable: [1, 10], reasons: [] },
      });
      assert(draft.codes.includes('USER_REDUCED'));
      assert(!draft.codes.includes('LOAD_STEP_UP'));
      assert(!draft.codes.includes('LOAD_STEP_DOWN'));
    },
  ]),
  [
    'P4b.5 T105 easier variant marks both the retired and replacement exposures USER_REDUCED',
    async () => {
      const source = await started([recipe('push-up', 3)]);
      logFirst(source);
      const r = reportSessionFeel(feelCommand(), NOW);
      assert.equal(r.kind, 'committed');
      const a = r.result.assessment;
      const choice = a.feel.options.find((o) => a.feel.recommendedOptionIds.includes(o.id));
      assert.equal(choice.why, 'variant_easier');
      assert.equal(acceptFeelOption(choice, a.basedOn).kind, 'committed');
      const loaded = await history.loadWindow('2026-10-01');
      assert.equal(loaded.records.length, 2);
      assert(loaded.records.every((r) => r.context.userReduced));
      assert.equal(loaded.records[0].context.feel, 'too_hard');
      assert.equal(loaded.records[0].sets.length, 3);
    },
  ],
  [
    'P4b.5 T72 too easy keeps extra work supplemental; advice requires explicit ACK',
    async () => {
      await started([recipe('crunch', 3)]);
      const r = reportSessionFeel(feelCommand('too_easy'), NOW);
      const a = r.result.assessment;
      assert.deepEqual(a.feel.recommendedOptionIds, ['next_prescription']);
      const choice = a.feel.options.find((o) => o.why === 'add_set');
      const before = snapshot();
      assert.equal(acceptFeelOption(choice, a.basedOn, 'choice', []).code, 'ACK_REQUIRED');
      assert.deepEqual(snapshot(), before);
      assert.equal(acceptFeelOption(choice, a.basedOn).kind, 'committed');
      const record = (await history.loadWindow('2026-10-01')).records[0];
      assert.equal(record.context.feel, 'too_easy');
      assert.equal(record.context.userReduced, false);
      assert.equal(record.sets.at(-1).planned.requiredForProgression, false);
      assert(record.sets.slice(0, 3).every((s) => s.planned.requiredForProgression));
    },
  ],
  [
    'P4b.5 reports use the latest specific feel, session-wide fallback and invalidate older choices',
    async () => {
      await started([recipe('crunch', 2), recipe('standing-calf-raise', 2)]);
      const first = reportSessionFeel(feelCommand('too_easy', 'f1'), NOW);
      const a = first.result.assessment;
      const choice = a.feel.options.find((o) => o.why === 'add_set');
      reportSessionFeel(feelCommand('too_hard', 'f2', null), new Date(NOW.getTime() + 1000));
      const after = await history.loadWindow('2026-10-01');
      assert.equal(after.records[0].context.feel, 'too_easy');
      assert.equal(after.records[1].context.feel, 'too_hard');
      const before = snapshot();
      assert.equal(acceptFeelOption(choice, a.basedOn).code, 'STALE_INPUT');
      assert.deepEqual(snapshot(), before);
      reportSessionFeel(feelCommand('too_hard', 'f3'), new Date(NOW.getTime() + 2000));
      assert.equal((await history.loadWindow('2026-10-01')).records[0].context.feel, 'too_hard');
    },
  ],
  [
    'P4b.5 replay survives session close and command ids cannot cross operations or sessions',
    async () => {
      await started([recipe('crunch')]);
      const cmd = feelCommand();
      const result = reportSessionFeel(cmd, NOW);
      sessions.closeSessionV2({ commandId: 'close', sessionId: 's1', how: 'completed' }, NOW);
      const before = snapshot();
      assert.deepEqual(reportSessionFeel(cmd, NOW), { ...result, kind: 'already_committed' });
      assert.equal(
        reportSessionFeel({ ...cmd, commandId: 'fresh' }, NOW).code,
        'SESSION_NOT_ACTIVE',
      );
      assert.equal(reportSessionFeel({ ...cmd, sessionId: 'other' }, NOW).code, 'INVALID_COMMAND');
      assert.equal(reportSessionFeel({ ...cmd, commandId: 'start' }, NOW).code, 'INVALID_COMMAND');
      assert.equal(
        sessions.recordFeelV2({ ...cmd, expected: undefined }, NOW).code,
        'INVALID_COMMAND',
      );
      assert.deepEqual(snapshot(), before);
    },
  ],
  [
    'P4b.5 malformed data, unknown sessions/exposures and stale revisions write nothing',
    async () => {
      await started([recipe('crunch')]);
      const cmd = feelCommand();
      for (const [patch, code] of [
        [{ feel: 'ok' }, 'INVALID_COMMAND'],
        [{ channel: 'invalid' }, 'INVALID_COMMAND'],
        [{ exposureId: 'missing' }, 'INVALID_COMMAND'],
        [{ sessionId: 'missing' }, 'UNKNOWN_SESSION'],
        [{ expected: { ...cmd.expected, planRevision: 2 } }, 'STALE_INPUT'],
        [{ expected: { ...cmd.expected, historyRevision: 0 } }, 'STALE_INPUT'],
      ]) {
        const before = snapshot();
        assert.equal(reportSessionFeel({ ...cmd, ...patch }, NOW).code, code);
        assert.deepEqual(snapshot(), before);
      }
      const plan = JSON.parse(all('SELECT plan_v2 FROM workouts')[0].plan_v2);
      plan.planRevision++;
      current.native.prepare('UPDATE workouts SET plan_v2 = ?').run(JSON.stringify(plan));
      const before = snapshot();
      assert.equal(reportSessionFeel(cmd, NOW).code, 'INVALID_PLAN');
      assert.deepEqual(snapshot(), before);
    },
  ],
  ...['feel_reports', 'exposure_outcomes', 'command_ledger'].map((table) => [
    `P4b.5 failure writing ${table} rolls back report, counters, outcomes and ledger`,
    async () => {
      await started([recipe('crunch')]);
      const cmd = feelCommand();
      const restore = failInsert('feel_fail', table);
      const before = snapshot();
      assert.equal(reportSessionFeel(cmd, NOW).kind, 'storage_error');
      assert.deepEqual(snapshot(), before);
      restore();
      assert.equal(reportSessionFeel(cmd, NOW).kind, 'committed');
    },
  ]),
  [
    'P4b.5 legacy recordFeelV2 raises history and validates data and ledger identity',
    async () => {
      await started([recipe('crunch')]);
      const { expected, ...cmd } = feelCommand();
      const first = reportSessionFeel({ ...cmd, expected }, NOW);
      assert.equal(first.kind, 'committed');
      const before = snapshot();
      assert.equal(sessions.recordFeelV2(cmd, NOW).code, 'INVALID_COMMAND');
      assert.equal(
        sessions.recordFeelV2({ ...cmd, commandId: 'invalid', feel: 'invalid' }, NOW).code,
        'INVALID_COMMAND',
      );
      assert.deepEqual(snapshot(), before);
      const historyBefore = loadSessionChangeSource('s1').snap.historyRevision;
      const legacy = { ...cmd, commandId: 'legacy' };
      assert.equal(sessions.recordFeelV2(legacy, NOW).kind, 'committed');
      assert.equal(loadSessionChangeSource('s1').snap.historyRevision, historyBefore + 1);
      assert.equal(sessions.recordFeelV2(legacy, NOW).kind, 'already_committed');
      assert.equal(
        sessions.recordFeelV2({ ...legacy, sessionId: 'other' }, NOW).code,
        'INVALID_COMMAND',
      );
    },
  ],
  [
    'P4b.5 a feel intent has no plan patch and cannot be accepted as a plan-changing command',
    async () => {
      await started([recipe('crunch')]);
      const { cmd } = preview();
      const before = snapshot();
      assert.equal(
        applySessionChange(
          { ...cmd, change: { kind: 'feel', exposureId: null, feel: 'too_hard' } },
          NOW,
        ).code,
        'INVALID_COMMAND',
      );
      assert.deepEqual(snapshot(), before);
    },
  ],
  [
    'the application entry point returns the promised committed result',
    async () => {
      await started();
      const result = application.applySessionChange(preview().cmd, NOW);
      assert(result instanceof Promise);
      assert.equal((await result).kind, 'committed');
    },
  ],
  [
    'T69 commits a fresh patch with a revision, ledger, counters and pending volume reservation',
    async () => {
      await started();
      const { cmd } = preview();
      const r = applySessionChange(cmd, NOW);
      assert.deepEqual(r, { kind: 'committed', result: { planRevision: 2 }, sessionRevision: 2 });
      const source = loadSessionChangeSource('s1');
      assert.equal(source.snap.historyRevision, cmd.expected.historyRevision + 1);
      assert.equal(source.session.plan.planRevision, 2);
      assert.equal(source.session.records[0].sets[0].disposition, 'pending');
      assert.equal(all('SELECT * FROM set_logs').length, 0);
      const revisions = all('SELECT * FROM session_plan_revisions ORDER BY plan_revision');
      assert.equal(revisions.length, 2);
      assert.equal(revisions[1].reason, 'user_change');
      assert.equal(revisions[1].channel, 'touch');
      const next = preview(add('dead-bug', 3));
      assert.equal(next.assessment.verdict, 'not_recommended');
      assert(next.assessment.checks.some((c) => c.code === 'DAY_MAX_EXCEEDED'));
    },
  ],
  [
    'T68 lost-answer retries commit once, including after a newer revision and session close',
    async () => {
      await started();
      const first = preview().cmd;
      const committed = applySessionChange(first, NOW);
      assert.equal(committed.kind, 'committed');
      const second = preview(add('standing-calf-raise'), 'second').cmd;
      assert.equal(applySessionChange(second, NOW).kind, 'committed');
      assert.equal(
        sessions.closeSessionV2({ commandId: 'close', sessionId: 's1', how: 'completed' }, NOW)
          .kind,
        'committed',
      );
      const before = snapshot();
      assert.deepEqual(applySessionChange(first, NOW), { ...committed, kind: 'already_committed' });
      assert.deepEqual(snapshot(), before);
    },
  ],
  ...['planRevision', 'historyRevision'].map((field) => [
    `T68 stale ${field} writes nothing`,
    async () => {
      await started();
      const { cmd } = preview();
      cmd.expected[field] += 1;
      const before = snapshot();
      const r = applySessionChange(cmd, NOW);
      assert.equal(r.kind, 'conflict');
      assert.equal(r.code, 'STALE_INPUT');
      assert.deepEqual(snapshot(), before);
    },
  ]),
  [
    'T68 altered intent or patch id is stale even when revisions still match',
    async () => {
      await started();
      for (const mutation of [(c) => c.change.sets++, (c) => (c.patchId = 'f'.repeat(64))]) {
        const { cmd } = preview();
        mutation(cmd);
        const before = snapshot();
        const r = applySessionChange(cmd, NOW);
        assert.equal(r.code, 'STALE_INPUT');
        assert.deepEqual(snapshot(), before);
      }
    },
  ],
  ...[
    ['preferences', "INSERT INTO preferences VALUES (1, '%PREFS%', 1, 'now')"],
    ['profile', "UPDATE user_profile SET rest_weekdays = '[6]' WHERE id = 1"],
    [
      'readiness',
      "INSERT INTO daily_logs (date, sleep_hours, energy, soreness, updated_at) VALUES ('2026-10-05', 5, 2, NULL, 'now')",
    ],
    ['catalog', "UPDATE exercises SET data_version = data_version + 1 WHERE id = 'crunch'"],
    ['inventory', "UPDATE bands SET cycle_count = cycle_count + 1 WHERE id = 'yellow'"],
  ].map(([name, sql]) => [
    `T68 ${name} changes invalidate the preview fingerprint`,
    async () => {
      await started();
      const { cmd, source } = preview();
      if (name === 'inventory')
        sql =
          'UPDATE bands SET calibration = \'{"points":[],"linearFit":null,"maxMeasuredKg":null}\' WHERE id = \'yellow\'';
      exec(sql.replace('%PREFS%', JSON.stringify(source.snap.preferences)));
      const before = snapshot();
      const r = applySessionChange(cmd, NOW);
      assert.equal(r.code, 'STALE_INPUT');
      assert.deepEqual(snapshot(), before);
    },
  ]),
  [
    'T68 logging after preview changes history and prevents pending overwrite',
    async () => {
      const source = await started([recipe('crunch', 3)]);
      const { cmd } = preview({
        kind: 'skip_remaining',
        exposureId: source.session.plan.exposures[0].id,
      });
      logFirst(source);
      const before = snapshot();
      assert.equal(applySessionChange(cmd, NOW).code, 'STALE_INPUT');
      assert.deepEqual(snapshot(), before);
    },
  ],
  [
    'T69 missing or incomplete ACK rejects without writes, the same id may then confirm',
    async () => {
      await started();
      const { cmd, assessment } = preview(add('crunch', 7));
      assert.equal(assessment.verdict, 'not_recommended');
      const required = [...cmd.acknowledged];
      assert(required.length >= 2);
      for (const acknowledged of [[], required.slice(1)]) {
        const before = snapshot();
        assert.equal(applySessionChange({ ...cmd, acknowledged }, NOW).code, 'ACK_REQUIRED');
        assert.deepEqual(snapshot(), before);
      }
      assert.equal(applySessionChange(cmd, NOW).kind, 'committed');
      const source = loadSessionChangeSource('s1');
      assert.deepEqual(source.session.plan.audit.overrides, [...required].sort());
      assert.equal(source.session.plan.exposures[0].sets.length, 7);
      const audit = auditPlan(
        source.session.plan,
        {
          mode: 'resume_session',
          catalog: source.snap.catalog,
          eligibility: source.snap.eligibility,
          modelOf: (s) => modelFor(s),
        },
        required,
      );
      assert.equal(audit.kind, 'valid');
    },
  ],
  [
    'a forged ACK never overrides a hard block and is not stored as a hard override',
    async () => {
      await started();
      const blocked = preview(add('missing')).cmd;
      blocked.acknowledged = ['NOT_IN_CATALOG'];
      const before = snapshot();
      assert.equal(applySessionChange(blocked, NOW).code, 'CHANGE_BLOCKED');
      assert.deepEqual(snapshot(), before);
      const safe = preview().cmd;
      safe.acknowledged = ['NOT_IN_CATALOG', 'DAY_MAX_EXCEEDED'];
      assert.equal(applySessionChange(safe, NOW).kind, 'committed');
      assert.deepEqual(loadSessionChangeSource('s1').session.plan.audit.overrides, []);
    },
  ],
  [
    'a newly blocked medical/user request is evaluated from database inputs',
    async () => {
      await started();
      const { cmd } = preview();
      exec('UPDATE user_profile SET excluded_exercise_ids = \'["crunch"]\' WHERE id = 1');
      const before = snapshot();
      assert.equal(applySessionChange(cmd, NOW).code, 'CHANGE_BLOCKED');
      assert.deepEqual(snapshot(), before);
    },
  ],
  [
    'ambiguous names are rejected without accepting a supplied patch',
    async () => {
      await started();
      const { cmd } = preview();
      cmd.change.exercise = { query: 'pompki' };
      const source = loadSessionChangeSource('s1');
      const exerciseRows = Object.values(source.snap.catalog).filter(
        (e) => e.id === 'crunch' || e.id === 'dead-bug',
      );
      for (const e of exerciseRows) {
        const patched = { ...e, name: 'Remis' };
        current.native
          .prepare('UPDATE exercises SET data = ? WHERE id = ?')
          .run(JSON.stringify(patched), e.id);
      }
      cmd.change.exercise = { query: 'Remis' };
      assert.equal(applySessionChange(cmd, NOW).code, 'CHANGE_BLOCKED');
    },
  ],
  ...['touch', 'voice', 'ai_proposal'].map((channel) => [
    `${channel} commits the same domain patch and records the channel`,
    async () => {
      await started();
      const { cmd, assessment } = preview();
      cmd.channel = channel;
      assert.equal(applySessionChange(cmd, NOW).kind, 'committed');
      const source = loadSessionChangeSource('s1');
      assert.deepEqual(source.session.plan.exposures, assessment.patch.plan.exposures);
      assert.equal(
        all('SELECT channel FROM session_plan_revisions WHERE plan_revision = 2')[0].channel,
        channel,
      );
    },
  ]),
  ...['reduce_remaining', 'skip_remaining', 'swap_remaining'].map((kind) => [
    `${kind} preserves actual and retired set dispositions in history`,
    async () => {
      const initial = await started([recipe('crunch', 3)]);
      logFirst(initial);
      const exposureId = initial.session.plan.exposures[0].id;
      const change = {
        kind,
        exposureId,
        ...(kind === 'swap_remaining'
          ? { exercise: { id: 'dead-bug' } }
          : kind === 'reduce_remaining'
            ? { dropSets: 1 }
            : {}),
      };
      const actual = all('SELECT * FROM set_logs');
      const original = all('SELECT * FROM session_plan_revisions');
      assert.equal(applySessionChange(preview(change).cmd, NOW).kind, 'committed');
      assert.deepEqual(all('SELECT * FROM set_logs'), actual);
      assert.deepEqual(
        all('SELECT * FROM session_plan_revisions WHERE plan_revision = 1'),
        original,
      );
      assert.equal(
        all('SELECT * FROM set_dispositions').length,
        kind === 'reduce_remaining' ? 1 : 2,
      );
      const loaded = await history.loadWindow('2026-10-01');
      const old = loaded.records.find((r) => r.exposureId === exposureId);
      assert.equal(old.sets.length, 3);
      assert.equal(old.sets[0].disposition, 'performed');
      assert.equal(old.context.userReduced, true);
      assert.equal(loaded.problems.length, 0);
      const outcome = all('SELECT * FROM exposure_outcomes').find(
        (o) => o.exposure_id === exposureId,
      );
      assert.equal(outcome.expected, 3);
      assert.equal(outcome.status, 'partial');
      if (kind === 'reduce_remaining') {
        logFirst(loadSessionChangeSource('s1'), 1);
        const after = (await history.loadWindow('2026-10-01')).records.find(
          (r) => r.exposureId === exposureId,
        );
        assert.equal(after.sets.filter((s) => s.disposition === 'performed').length, 2);
        assert(after.sets.some((s) => s.disposition === 'skipped'));
        const evidence = qualifyExposure(
          after,
          { dropOffAllowance: 2 },
          modelFor(after.sets[0].planned.resistance),
        );
        assert.equal(evidence.performance, 'not_evaluable');
        assert(evidence.reasons.includes('USER_REDUCED'));
      }
    },
  ]),
  [
    'a lighter resistance revision retains the retired prescription and reduction context',
    async () => {
      const source = await started([recipe('db-floor-press', 3)]);
      logFirst(source);
      const { cmd } = preview({
        kind: 'reduce_remaining',
        exposureId: source.session.plan.exposures[0].id,
        easier: true,
      });
      assert.equal(applySessionChange(cmd, NOW).kind, 'committed');
      const loaded = await history.loadWindow('2026-10-01');
      assert.equal(loaded.problems.length, 0);
      assert(loaded.records.every((r) => r.context.userReduced));
    },
  ],
  [
    'appending sets preserves prior skips and the original prescriptions',
    async () => {
      const source = await started([recipe('crunch', 3)]);
      const exposure = source.session.plan.exposures[0];
      sessions.skipSetsV2(
        {
          commandId: 'skip',
          sessionId: 's1',
          plannedSetIds: [exposure.sets[0].id],
          reason: 'time',
          expectedSessionRevision: 1,
        },
        NOW,
      );
      const skips = all('SELECT * FROM set_dispositions');
      const { cmd } = preview({ kind: 'add_sets', exposureId: exposure.id, sets: 1 });
      assert.equal(applySessionChange(cmd, NOW).kind, 'committed');
      assert.deepEqual(all('SELECT * FROM set_dispositions'), skips);
      const loaded = await history.loadWindow('2026-10-01');
      assert.equal(loaded.records[0].sets.length, 4);
      assert.equal(loaded.records[0].sets[0].disposition, 'skipped');
    },
  ],
  [
    'a ranked alternative can be re-assessed and accepted using its own intent and patch',
    async () => {
      await started();
      const source = loadSessionChangeSource('s1');
      const a = assessSessionChange(source.snap, source.session, add());
      const alt = a.alternatives[0];
      assert(alt);
      const { cmd } = preview(alt.change);
      assert.equal(cmd.patchId, alt.patchId);
      assert.equal(applySessionChange(cmd, NOW).kind, 'committed');
    },
  ],
  ...['session_plan_revisions', 'set_dispositions', 'exposure_outcomes', 'command_ledger'].map(
    (table) => [
      `failure in ${table} rolls back the entire change and retry is safe`,
      async () => {
        const source = await started([recipe('crunch', 3)]);
        const { cmd } = preview({
          kind: 'reduce_remaining',
          exposureId: source.session.plan.exposures[0].id,
          dropSets: 1,
        });
        const before = snapshot();
        const restore = failInsert('fail_change', table);
        const r = applySessionChange(cmd, NOW);
        assert.equal(r.kind, 'storage_error');
        assert.equal(r.retryable, true);
        assert.deepEqual(snapshot(), before);
        restore();
        assert.equal(applySessionChange(cmd, NOW).kind, 'committed');
        assert.equal(applySessionChange(cmd, NOW).kind, 'already_committed');
      },
    ],
  ),
  [
    'validates command data, session presence and session status without writes',
    async () => {
      await started();
      const { cmd } = preview();
      for (const patch of [
        { channel: 'invalid' },
        { acknowledged: ['INVALID'] },
        { expected: { planRevision: 1, historyRevision: -1 } },
        { change: { kind: 'unsupported' } },
      ]) {
        const before = snapshot();
        assert.equal(applySessionChange({ ...cmd, ...patch }, NOW).code, 'INVALID_COMMAND');
        assert.deepEqual(snapshot(), before);
      }
      assert.equal(
        applySessionChange({ ...cmd, sessionId: 'missing' }, NOW).code,
        'UNKNOWN_SESSION',
      );
      assert.equal(loadSessionChangeSource('missing'), null);
      sessions.closeSessionV2({ commandId: 'close', sessionId: 's1', how: 'completed' }, NOW);
      assert.equal(applySessionChange(cmd, NOW).code, 'SESSION_NOT_ACTIVE');
    },
  ],
  [
    'command ids of another operation cannot masquerade as committed session changes',
    async () => {
      await started();
      const { cmd } = preview();
      cmd.commandId = 'start';
      assert.equal(applySessionChange(cmd, NOW).code, 'INVALID_COMMAND');
    },
  ],
  [
    'an invalid stored plan is blocked without re-stamping its integrity',
    async () => {
      await started();
      const { cmd } = preview();
      const row = all('SELECT plan_v2 FROM workouts')[0];
      const plan = JSON.parse(row.plan_v2);
      plan.exposures.push(recipe('crunch'));
      current.native.prepare('UPDATE workouts SET plan_v2 = ?').run(JSON.stringify(plan));
      const before = snapshot();
      const result = applySessionChange(cmd, NOW);
      assert.equal(result.code, 'INVALID_PLAN');
      assert.deepEqual(snapshot(), before);
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
