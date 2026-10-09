/* P5.6: the model consults the running workout on real SQLite: it reads the session, asks the
 * engine about a change, puts it on a card, and the card is accepted through the transaction that
 * assesses once more and writes. The model writes nothing on its way. */
const { assert, current, all, seeded } = require('./sqlite-harness.cjs');
const { previewDay, acceptDay } = require('../repositories/planningV2.ts');
const { applySessionChange } = require('../repositories/sessionChanges.ts');
const { loadActiveSessionSource } = require('../repositories/sessionChangeSource.ts');
const { createSessionToolHooks } = require('../../ai/tools/sessionEnvironment.ts');
const { executeTool } = require('../../ai/tools/execute.ts');
const { doTheSession } = require('./sqlite-day-helpers.cjs');

const at = (h, m = 0) => new Date(2026, 9, 5, h, m, 0);

async function running() {
  await seeded();
  const request = { sessionId: 'live' };
  const shown = previewDay(request, at(9));
  const accepted = acceptDay(
    { commandId: 'start', request, expectedPlanHash: shown.planHash, timeZone: null },
    at(9, 1),
  );
  assert.equal(accepted.kind, 'committed');
  return shown.output.result.plan;
}
const tools = () => {
  const hooks = createSessionToolHooks(() => loadActiveSessionSource());
  const env = {
    activeSession: hooks.activeSession,
    assessChange: hooks.assessChange,
    proposeSessionChange: hooks.proposeChange,
  };
  const call = (name, input) =>
    executeTool({ id: `c-${name}`, name, input }, env).then((r) => r.output);
  return { hooks, call };
};
const tables = () =>
  JSON.stringify(
    ['workouts', 'set_logs', 'session_plan_revisions', 'command_ledger', 'planning_revisions'].map(
      (t) => all(`SELECT * FROM ${t}`),
    ),
  );

const CASES = [
  [
    'with no workout running the model is told so and nothing is written',
    async () => {
      await seeded();
      const before = tables();
      const { call } = tools();
      assert.deepEqual(await call('getActiveSession', {}), { error: 'no_active_session' });
      assert.deepEqual(
        await call('assessSessionChange', { kind: 'skip_remaining', exposureId: 'x' }),
        {
          error: 'no_active_session',
        },
      );
      assert.equal(tables(), before);
    },
  ],
  [
    'the model reads the running workout as the engine has it',
    async () => {
      const plan = await running();
      const { call } = tools();
      const summary = await call('getActiveSession', {});
      assert.equal(summary.sessionId, 'live');
      assert.equal(summary.planRevision, 1);
      assert.equal(summary.exposures.length, plan.exposures.length);
      assert.ok(summary.exposures.every((e) => e.sets.done === 0 && e.sets.pending > 0));
      assert.ok(summary.timeRemainingSec > 0);
    },
  ],
  [
    'asking about a change writes nothing; the answer is the same each time it is asked',
    async () => {
      const plan = await running();
      const { call, hooks } = tools();
      const before = tables();
      const input = { kind: 'skip_remaining', exposureId: plan.exposures[0].id };
      const a = await call('assessSessionChange', input);
      hooks.newTurn();
      const b = await call('assessSessionChange', input);
      assert.deepEqual(a, b);
      assert.ok(['ok', 'ok_with_changes'].includes(a.verdict), a.verdict);
      assert.equal(tables(), before);
    },
  ],
  [
    'a change proposed by the model is accepted on the phone through the transaction, and not before',
    async () => {
      const plan = await running();
      const { call, hooks } = tools();
      const input = { kind: 'skip_remaining', exposureId: plan.exposures[0].id };
      const assessed = await call('assessSessionChange', input);
      const before = tables();
      const proposed = await call('proposeSessionChange', {
        assessmentId: assessed.assessmentId,
        patchId: assessed.patchId,
      });
      assert.equal(proposed.kind, 'session_change');
      assert.equal(proposed.requiresAcceptance, true);
      assert.equal(tables(), before, 'a proposal writes nothing');
      const card = hooks.proposals.get(proposed.proposalId);
      assert.ok(card);
      const result = applySessionChange(
        {
          commandId: 'accept-card',
          sessionId: 'live',
          patchId: card.patchId,
          change: card.change,
          expected: card.expected,
          acknowledged: card.acknowledge,
          channel: 'ai_proposal',
        },
        at(9, 20),
      );
      assert.equal(result.kind, 'committed', JSON.stringify(result));
      const [workout] = all("SELECT plan_revision FROM workouts WHERE id = 'live'");
      assert.equal(workout.plan_revision, 2);
      const [revision] = all(
        'SELECT channel, reason FROM session_plan_revisions WHERE plan_revision = 2',
      );
      assert.equal(revision.channel, 'ai_proposal');
    },
  ],
  [
    'a card is stale when the workout moved on before it was accepted',
    async () => {
      const plan = await running();
      const { call } = tools();
      const assessed = await call('assessSessionChange', {
        kind: 'add_sets',
        exposureId: plan.exposures[0].id,
        sets: 1,
      });
      doTheSession(plan, at(10));
      const proposed = await call('proposeSessionChange', {
        assessmentId: assessed.assessmentId,
        patchId: assessed.patchId,
      });
      assert.ok(
        ['stale_assessment', 'no_active_session'].includes(proposed.error),
        JSON.stringify(proposed),
      );
    },
  ],
  [
    'a change advised against is proposed with the advice the person has to accept, and applying without it is refused',
    async () => {
      const plan = await running();
      doTheSessionPart(plan);
      const { call, hooks } = tools();
      const exposure = plan.exposures.find((e) => e.sets.some((s) => s.role === 'work'));
      const assessed = await call('assessSessionChange', {
        kind: 'add_sets',
        exposureId: exposure.id,
        sets: 6,
      });
      assert.equal(assessed.verdict, 'not_recommended', JSON.stringify(assessed.checks));
      const proposed = await call('proposeSessionChange', {
        assessmentId: assessed.assessmentId,
        patchId: assessed.patchId,
      });
      assert.ok(proposed.acknowledge.length > 0);
      const card = hooks.proposals.get(proposed.proposalId);
      const refused = applySessionChange(
        {
          commandId: 'without-ack',
          sessionId: 'live',
          patchId: card.patchId,
          change: card.change,
          expected: card.expected,
          acknowledged: [],
          channel: 'ai_proposal',
        },
        at(9, 30),
      );
      assert.equal(refused.kind, 'rejected');
      assert.equal(refused.code, 'ACK_REQUIRED');
    },
  ],
];

/** Does one set of the first exposure, so that the workout is under way with some work done. */
function doTheSessionPart(plan) {
  const { legalObservation } = require('../../domain/__tests__/planV2Fixtures.ts');
  const sessions = require('../repositories/sessionsV2.ts');
  const set = plan.exposures[0].sets[0];
  const base = legalObservation();
  const revision = all("SELECT revision FROM workouts WHERE id = 'live'")[0].revision;
  const value =
    set.target.kind === 'duration'
      ? { kind: 'duration', seconds: set.target.targetSec }
      : { kind: 'reps', reps: set.target.target };
  const r = sessions.logSetV2(
    {
      commandId: 'one-set',
      sessionId: 'live',
      plannedSetId: set.id,
      expectedSessionRevision: revision,
      observation: {
        status: 'performed',
        amount: { ...base.amount, value },
        resistance: { ...base.resistance, value: set.resistance },
        rir: { ...base.rir, value: 2 },
        shortfall: null,
        performedAt: at(9, 5).toISOString(),
      },
    },
    at(9, 5),
  );
  assert.equal(r.kind, 'committed');
}

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
