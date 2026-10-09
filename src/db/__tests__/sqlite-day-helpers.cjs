/* Shared by the scripts that run days of engine v2 against real SQLite. */
const { assert, all } = require('./sqlite-harness.cjs');
const sessions = require('../repositories/sessionsV2.ts');
const { legalObservation } = require('../../domain/__tests__/planV2Fixtures.ts');

/** Does every set of the running session exactly as planned, and closes it. */
function doTheSession(plan, when, amountOf) {
  for (const exposure of plan.exposures) {
    for (const set of exposure.sets) {
      const base = legalObservation();
      const revision = all('SELECT revision FROM workouts WHERE id = ?', plan.sessionId)[0]
        .revision;
      const target = set.target;
      const value =
        target.kind === 'duration'
          ? { kind: 'duration', seconds: amountOf ? amountOf(set) : target.targetSec }
          : { kind: 'reps', reps: amountOf ? amountOf(set) : target.target };
      const r = sessions.logSetV2(
        {
          commandId: `log-${set.id}`,
          sessionId: plan.sessionId,
          plannedSetId: set.id,
          expectedSessionRevision: revision,
          observation: {
            status: 'performed',
            amount: { ...base.amount, value },
            resistance: { ...base.resistance, value: set.resistance },
            rir: { ...base.rir, value: set.targetRir?.min ?? 2 },
            shortfall: null,
            performedAt: when.toISOString(),
          },
        },
        when,
      );
      assert.equal(r.kind, 'committed', JSON.stringify(r));
    }
  }
  const closed = sessions.closeSessionV2(
    { commandId: `close-${plan.sessionId}`, sessionId: plan.sessionId, how: 'completed' },
    when,
  );
  assert.equal(closed.kind, 'committed', JSON.stringify(closed));
}

module.exports = { doTheSession };
