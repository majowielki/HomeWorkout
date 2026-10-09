/* P5.6c: the proposals of the chat on the week of engine, on real SQLite: a change of the plan, a day
 * composed with the coach and an extra session are previews until the person accepts; accepting writes
 * once, and anything that moved in between makes the card stale. */
const { assert, current, all, exec, seeded } = require('./sqlite-harness.cjs');
const {
  createProposalController,
  ProposalChangedError,
} = require('../../app-services/coach/proposals.ts');
const { loadWeekContext, syncWeek } = require('../repositories/weekPlan.ts');
const { previewDay, acceptDay } = require('../repositories/planning.ts');
const { doTheSession } = require('./sqlite-day-helpers.cjs');
const { createPhonePlanTools } = require('../../app-services/queries/planTools.ts');

const at = (h, m = 0) => new Date(2026, 9, 5, h, m, 0);

function controller(now = at(9)) {
  let n = 0;
  return createProposalController({
    context: () => loadWeekContext(now),
    inProgress: () => all("SELECT id FROM workouts WHERE status = 'in_progress'").length > 0,
    id: () => `proposal-${++n}`,
    now: () => now,
  });
}
const rest = (daysAhead) => ({
  constraints: [
    { kind: 'rest_day', muscles: [], fromDaysAhead: daysAhead, days: 1, reason: 'busy' },
  ],
  note: 'Dzień wolny na prośbę.',
});
const generations = () => all('SELECT * FROM plan_generations').map((g) => g.id);

/** Plans, starts and finishes the main workout of the day. */
function trainToday() {
  const request = { sessionId: 'main' };
  const shown = previewDay(request, at(9));
  assert.equal(
    acceptDay(
      { commandId: 'start', request, expectedPlanHash: shown.planHash, timeZone: null },
      at(9, 1),
    ).kind,
    'committed',
  );
  doTheSession(shown.output.result.plan, at(9, 30));
}

const CASES = [
  [
    'the chat controller exposes a session card and applies its assessed patch only after acceptance',
    async () => {
      await seeded();
      syncWeek({}, at(9));
      const shown = previewDay({ sessionId: 'live' }, at(9));
      const started = acceptDay(
        {
          commandId: 'start-live',
          request: shown.request,
          expectedPlanHash: shown.planHash,
          timeZone: null,
        },
        at(9),
      );
      assert.equal(started.kind, 'committed');
      const c = controller();
      c.beginTurn('Pomiń resztę pierwszego ćwiczenia', '2026-10-05');
      assert.equal((await c.tools.activeSession()).sessionId, 'live');
      const assessed = await c.tools.assessChange({
        kind: 'skip_remaining',
        exposureId: shown.output.result.plan.exposures[0].id,
      });
      const proposed = await c.tools.proposeSessionChange({
        assessmentId: assessed.assessmentId,
        patchId: assessed.patchId,
      });
      assert.equal(proposed.kind, 'session_change');
      const card = c.resolve(proposed.proposalId);
      assert.equal(card.summary.kind, 'session_change');
      assert.ok(card.summary.sentences.length > 0);
      assert.equal(all('SELECT * FROM set_dispositions').length, 0);
      assert.equal((await c.apply(proposed.proposalId)).workoutId, 'live');
      assert.ok(all('SELECT * FROM set_dispositions').length > 0);
      assert.equal(c.resolve(proposed.proposalId), null);
    },
  ],
  [
    'a session card becomes stale after another command, and old assessments expire on a new question',
    async () => {
      await seeded();
      const shown = previewDay({ sessionId: 'live' }, at(9));
      acceptDay(
        {
          commandId: 'start-live',
          request: shown.request,
          expectedPlanHash: shown.planHash,
          timeZone: null,
        },
        at(9),
      );
      const c = controller();
      c.beginTurn('Pomiń ćwiczenie', '2026-10-05');
      const exposure = shown.output.result.plan.exposures[0];
      const assessed = await c.tools.assessChange({
        kind: 'skip_remaining',
        exposureId: exposure.id,
      });
      const intent = { assessmentId: assessed.assessmentId, patchId: assessed.patchId };
      const proposed = await c.tools.proposeSessionChange(intent);
      const { skipSets: skipSets } = require('../repositories/sessions.ts');
      assert.equal(
        skipSets(
          {
            commandId: 'skip-one',
            sessionId: 'live',
            plannedSetIds: [exposure.sets[0].id],
            expectedSessionRevision: 1,
          },
          at(9, 2),
        ).kind,
        'committed',
      );
      await assert.rejects(c.apply(proposed.proposalId), ProposalChangedError);
      c.beginTurn('Nowe pytanie', '2026-10-05');
      assert.equal(c.resolve(proposed.proposalId), null);
      assert.deepEqual(await c.tools.proposeSessionChange(intent), { error: 'stale_assessment' });
      const fresh = await c.tools.assessChange({ kind: 'skip_remaining', exposureId: exposure.id });
      const delayed = c.tools.proposeSessionChange({
        assessmentId: fresh.assessmentId,
        patchId: fresh.patchId,
      });
      c.beginTurn('Jeszcze inne pytanie', '2026-10-05');
      assert.deepEqual(await delayed, { error: 'failed' });
    },
  ],
  [
    'a request for a rest day is previewed, applied once, and the week is planned with it',
    async () => {
      await seeded();
      syncWeek({}, at(9));
      const c = controller();
      c.beginTurn('Chcę dzień wolny pojutrze', '2026-10-05');
      const summary = await c.tools.proposeChange(rest(2));
      assert.equal(summary.kind, 'plan');
      assert.ok(summary.changes.some((x) => x.after.date === '2026-10-07' && x.after.rest));
      assert.equal(all('SELECT * FROM plan_constraints').length, 0, 'a preview writes nothing');
      assert.equal(c.resolve(summary.proposalId).summary.proposalId, summary.proposalId);
      await c.apply(summary.proposalId);
      const [constraint] = all('SELECT * FROM plan_constraints');
      assert.equal(constraint.kind, 'rest_day');
      assert.equal(constraint.source, 'coach');
      assert.equal(constraint.from_date, '2026-10-07');
      assert.deepEqual(generations().includes(summary.proposalId), true);
      const day = all("SELECT selection FROM planned_days WHERE date = '2026-10-07'")[0];
      assert.equal(day.selection, null);
      await assert.rejects(() => c.apply(summary.proposalId), ProposalChangedError);
      assert.equal(all('SELECT * FROM plan_constraints').length, 1);
    },
  ],
  [
    'a card is stale when the week moved between the preview and the acceptance',
    async () => {
      await seeded();
      syncWeek({}, at(9));
      const c = controller();
      c.beginTurn('Chcę dzień wolny pojutrze', '2026-10-05');
      const summary = await c.tools.proposeChange(rest(2));
      exec(
        "INSERT INTO plan_constraints (id, kind, muscles, from_date, until_date, reason, source, created_at) VALUES ('mine', 'rest_day', '[]', '2026-10-08', '2026-10-08', 'busy', 'user', '2026-10-05T08:00:00Z')",
      );
      const before = JSON.stringify([all('SELECT * FROM plan_constraints'), generations()]);
      await assert.rejects(() => c.apply(summary.proposalId), ProposalChangedError);
      assert.equal(JSON.stringify([all('SELECT * FROM plan_constraints'), generations()]), before);
    },
  ],
  [
    'a request that does not hold is refused before it is previewed, and a running workout stops proposals',
    async () => {
      await seeded();
      const c = controller();
      c.beginTurn('Zrób dzień wolny', '2026-10-05');
      assert.deepEqual(
        await c.tools.proposeChange({ ...rest(2), note: 'Zrób 12 powtórzeń z 8 kg' }),
        { error: 'invalid_input' },
      );
      c.beginTurn('Chcę dzień wolny pojutrze', '2026-10-04');
      assert.deepEqual(await c.tools.proposeChange(rest(2)), { error: 'date_changed' });
      c.beginTurn('Chcę dzień wolny pojutrze', '2026-10-05');
      const request = { sessionId: 'live' };
      const shown = previewDay(request, at(9));
      acceptDay(
        { commandId: 'start', request, expectedPlanHash: shown.planHash, timeZone: null },
        at(9, 1),
      );
      assert.deepEqual(await c.tools.proposeChange(rest(2)), { error: 'in_progress' });
      assert.deepEqual(
        await c.tools.proposeDay({
          days: [{ daysAhead: 1, slots: [{ slotId: 'squat' }] }],
          note: 'Układamy.',
        }),
        {
          error: 'in_progress',
        },
      );
      assert.deepEqual(await c.tools.proposeExtra({ focusMuscles: ['core'] }), {
        error: 'in_progress',
      });
    },
  ],
  [
    'a day is composed from the options of the engine and applied as a request',
    async () => {
      await seeded();
      syncWeek({}, at(9));
      const c = controller();
      c.beginTurn('Ułóż jutrzejszy dzień z przysiadem', '2026-10-05');
      const options = await c.tools.dayOptions({ daysAhead: 1 });
      assert.equal(options.date, '2026-10-06');
      const open = options.options.find((o) => o.available);
      assert.ok(open, 'some movement can be trained');
      const summary = await c.tools.proposeDay({
        days: [{ daysAhead: 1, slots: [{ slotId: open.slotId, sets: 2 }] }],
        note: 'Układamy dzień.',
      });
      assert.equal(summary.kind, 'compose');
      assert.equal(summary.days[0].applied, true);
      await c.apply(summary.proposalId);
      const [constraint] = all("SELECT * FROM plan_constraints WHERE kind = 'compose_day'");
      assert.equal(constraint.from_date, '2026-10-06');
      assert.deepEqual(JSON.parse(constraint.items), [{ slotId: open.slotId, sets: 2 }]);
      const day = JSON.parse(
        all("SELECT selection FROM planned_days WHERE date = '2026-10-06'")[0].selection,
      );
      assert.deepEqual(
        day.map((d) => d.slotId),
        [open.slotId],
      );
      // Composed again, the earlier composition is taken back.
      c.beginTurn('Ułóż jutrzejszy dzień inaczej', '2026-10-05');
      const second =
        open.slotId === options.options.filter((o) => o.available)[1]?.slotId
          ? null
          : options.options.filter((o) => o.available)[1];
      if (second) {
        const again = await c.tools.proposeDay({
          days: [{ daysAhead: 1, slots: [{ slotId: second.slotId }] }],
          note: 'Układamy dzień.',
        });
        await c.apply(again.proposalId);
        assert.equal(
          all("SELECT * FROM plan_constraints WHERE kind = 'compose_day' AND revoked_at IS NULL")
            .length,
          1,
        );
      }
    },
  ],
  [
    'an extra session needs the main one done, and starts as an extra session when accepted',
    async () => {
      await seeded();
      const c = controller(at(12));
      c.beginTurn('Chcę dodatkowy trening na brzuch', '2026-10-05');
      assert.deepEqual(await c.tools.proposeExtra({ focusMuscles: ['core'] }), {
        error: 'finish_first',
      });
      trainToday();
      c.beginTurn('Chcę dodatkowy trening na brzuch', '2026-10-05');
      let summary = null;
      for (const muscle of [
        'calves',
        'forearms',
        'biceps',
        'triceps',
        'shoulders',
        'lats',
        'core',
      ]) {
        const found = await c.tools.proposeExtra({ focusMuscles: [muscle] });
        if (found.error === undefined) {
          summary = found;
          break;
        }
        assert.ok(['no_plan'].includes(found.error), found.error);
      }
      assert.notEqual(summary, null, 'some muscle still has room today');
      assert.equal(summary.kind, 'extra');
      assert.equal(
        all("SELECT * FROM workouts WHERE status = 'in_progress'").length,
        0,
        'a preview starts nothing',
      );
      const applied = await c.apply(summary.proposalId);
      assert.ok(applied.workoutId);
      const [extra] = all("SELECT session_plan FROM workouts WHERE status = 'in_progress'");
      assert.equal(JSON.parse(extra.session_plan).kind, 'extra');
    },
  ],
  [
    'the week the tool reads shows the workout under way as today',
    async () => {
      await seeded();
      syncWeek({}, at(9));
      const request = { sessionId: 'live' };
      const shown = previewDay(request, at(9));
      acceptDay(
        { commandId: 'start', request, expectedPlanHash: shown.planHash, timeZone: null },
        at(9, 1),
      );
      const week = await controller().tools.week();
      assert.equal(week.days.length, 7);
      assert.equal(week.days[0].status, 'in_progress');
      assert.ok(week.days[0].exercises.length > 0);
    },
  ],
  [
    'the explanation of the day is the week’s plan before the workout starts and the frozen one after',
    async () => {
      await seeded();
      syncWeek({}, at(9));
      const { explainPlan } = createPhonePlanTools();
      // The tool reads the clock of the phone: the day of the test is its own.
      const real = Date;
      global.Date = class extends real {
        constructor(...args) {
          super(...(args.length === 0 ? [at(9)] : args));
        }
        static now() {
          return at(9).getTime();
        }
      };
      try {
        const before = await explainPlan({ daysAgo: 0 });
        assert.equal(before.source, 'today');
        assert.ok(before.exercises.length > 0);
        assert.ok(before.exercises.every((e) => e.reasons.length > 0));
        assert.deepEqual(await explainPlan({ daysAgo: 2 }), { error: 'no_plan' });
        const request = { sessionId: 'live' };
        const shown = previewDay(request, at(9));
        acceptDay(
          { commandId: 'start', request, expectedPlanHash: shown.planHash, timeZone: null },
          at(9, 1),
        );
        const after = await explainPlan({ daysAgo: 0 });
        assert.equal(after.source, 'session');
        assert.equal(after.exercises.length, shown.output.result.plan.exposures.length);
      } finally {
        global.Date = real;
      }
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
