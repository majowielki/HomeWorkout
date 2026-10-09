/* P5.4: the question "step up?" asked after two exposures made of untouched suggestions, and
 * what becomes of the answer, on real SQLite and the whole path from the database to the plan. */
const { assert, current, all, seeded } = require('./sqlite-harness.cjs');
const { previewDay, acceptDay } = require('../repositories/planningV2.ts');
const { answerPrescription, readAnswers } = require('../repositories/answers.ts');
const { doTheSession } = require('./sqlite-day-helpers.cjs');
const database = () => require('../client').db;

const at = (day, hour = 9) => new Date(2026, 9, day, hour, 0, 0);
const top = (set) => (set.target.kind === 'duration' ? set.target.maxSec : set.target.max);

/** Plans, starts and finishes a day with every set at the top of its range and every suggestion untouched. */
function trainAtTheTop(day) {
  const request = { sessionId: `day-${day}` };
  const shown = previewDay(request, at(day));
  assert.ok(shown.planHash, JSON.stringify(shown.output.result.kind));
  const accepted = acceptDay(
    { commandId: `accept-${day}`, request, expectedPlanHash: shown.planHash, timeZone: null },
    at(day, 10),
  );
  assert.equal(accepted.kind, 'committed', JSON.stringify(accepted));
  doTheSession(shown.output.result.plan, at(day, 11), top);
  return shown.output.result.plan;
}
const questions = (day) =>
  previewDay({ sessionId: `ask-${day}` }, at(day)).output.result.plan.exposures.filter(
    (e) => e.trace.code === 'CONFIRM_STEP_UP',
  );

/** Trains until some exercise has been asked about; returns the day it was asked on and the exposure. */
function untilAsked() {
  for (let day = 5; day < 20; day += 1) {
    const asked = questions(day);
    if (asked.length > 0) return { day, asked: asked[0] };
    trainAtTheTop(day);
  }
  throw new Error('nothing was ever asked about');
}
const newestId = (key) => {
  const rows = all(
    "SELECT exposure_id FROM set_logs WHERE comparison_key = ? AND progression_scope = 'primary' ORDER BY performed_on DESC, exposure_id DESC LIMIT 1",
    key,
  );
  return rows[0].exposure_id;
};
const planOf = (day) =>
  previewDay({ sessionId: `again-${day}` }, at(day)).output.result.plan.exposures;
const answer = (day, asked, as, id = 'ans') =>
  answerPrescription(
    {
      commandId: id,
      comparisonKey: asked.comparisonKey,
      kind: 'step_up',
      answer: as,
      afterExposureId: newestId(asked.comparisonKey),
      on: `2026-10-${String(day).padStart(2, '0')}`,
    },
    at(day, 12),
  );

const CASES = [
  [
    'after two exposures of untouched suggestions at the top of the range the plan asks before it steps up',
    async () => {
      await seeded();
      const { asked } = untilAsked();
      assert.equal(asked.trace.code, 'CONFIRM_STEP_UP');
    },
  ],
  [
    'a "yes" lets the step up through, once',
    async () => {
      await seeded();
      const { day, asked } = untilAsked();
      const r = answer(day, asked, 'yes');
      assert.equal(r.kind, 'committed', JSON.stringify(r));
      const now = planOf(day).find((e) => e.comparisonKey === asked.comparisonKey);
      assert.ok(now, 'the exercise is in the plan');
      assert.notEqual(now.trace.code, 'CONFIRM_STEP_UP');
      assert.ok(
        ['LOAD_STEP_UP', 'PROBE_PLANNED'].includes(now.trace.code),
        `stepped up, not ${now.trace.code}`,
      );
    },
  ],
  [
    'a "not yet" is remembered as a deferral and the question is not asked again at once',
    async () => {
      await seeded();
      const { day, asked } = untilAsked();
      assert.equal(answer(day, asked, 'no').kind, 'committed');
      const now = planOf(day).find((e) => e.comparisonKey === asked.comparisonKey);
      assert.equal(now.trace.code, 'USER_DEFERRED');
    },
  ],
  [
    'an answer applies only until a newer exposure of the exercise exists',
    async () => {
      await seeded();
      const { day, asked } = untilAsked();
      assert.equal(answer(day, asked, 'yes').kind, 'committed');
      const before = database().transaction((tx) => readAnswers(tx, []));
      assert.deepEqual(before, {}, 'with no history it matches no exposure');
      // The exercise is done again: the answer was about the exposure before it.
      const plan = trainAtTheTop(day);
      assert.ok(plan.exposures.length > 0);
      const read = database().transaction((tx) => {
        const { readNormalizedHistory } = require('../repositories/historyV2.ts');
        const { workouts } = require('../schema.ts');
        return readAnswers(tx, readNormalizedHistory(tx, tx.select().from(workouts).all()).records);
      });
      const newer = plan.exposures.some((e) => e.comparisonKey === asked.comparisonKey);
      assert.equal(read[asked.comparisonKey]?.stepUp === 'yes', !newer);
    },
  ],
  [
    'the same command twice answers once; a changed mind is another command; a stale question is refused',
    async () => {
      await seeded();
      const { day, asked } = untilAsked();
      assert.equal(answer(day, asked, 'no', 'a1').kind, 'committed');
      assert.equal(answer(day, asked, 'no', 'a1').kind, 'already_committed');
      assert.equal(all('SELECT * FROM prescription_answers').length, 1);
      assert.equal(answer(day, asked, 'yes', 'a2').kind, 'committed');
      const [row] = all('SELECT * FROM prescription_answers');
      assert.equal(row.answer, 'yes');
      assert.equal(all('SELECT * FROM prescription_answers').length, 1);
      const stale = answerPrescription(
        {
          commandId: 'a3',
          comparisonKey: asked.comparisonKey,
          kind: 'step_up',
          answer: 'yes',
          afterExposureId: 'an-older-exposure',
          on: '2026-10-09',
        },
        at(day, 13),
      );
      assert.equal(stale.kind, 'conflict');
      assert.equal(stale.code, 'STALE_INPUT');
      const bad = answerPrescription(
        {
          commandId: 'a4',
          comparisonKey: '',
          kind: 'step_up',
          answer: 'yes',
          afterExposureId: 'x',
          on: '2026-10-09',
        },
        at(day, 13),
      );
      assert.equal(bad.code, 'INVALID_COMMAND');
    },
  ],
  [
    'an answer changes the plan the person was shown, so an old preview is refused',
    async () => {
      await seeded();
      const { day, asked } = untilAsked();
      const request = { sessionId: 'later' };
      const shown = previewDay(request, at(day));
      assert.equal(answer(day, asked, 'no').kind, 'committed');
      const r = acceptDay(
        { commandId: 'late', request, expectedPlanHash: shown.planHash, timeZone: null },
        at(day, 14),
      );
      assert.equal(r.kind, 'conflict');
      assert.equal(r.code, 'STALE_INPUT');
    },
  ],
  [
    'a deferred easier variant is remembered by date',
    async () => {
      await seeded();
      const r = answerPrescription(
        {
          commandId: 'v1',
          comparisonKey: 'k',
          kind: 'variant_down',
          answer: 'no',
          afterExposureId: 'e1',
          on: '2026-10-08',
        },
        at(8),
      );
      assert.equal(r.kind, 'committed');
      assert.deepEqual(
        database().transaction((tx) => readAnswers(tx, [])),
        { k: { variantDownDeferredAt: '2026-10-08' } },
      );
      // Accepting it is a change of the block's choice, not an answer to remember.
      answerPrescription(
        {
          commandId: 'v2',
          comparisonKey: 'k',
          kind: 'variant_down',
          answer: 'yes',
          afterExposureId: 'e1',
          on: '2026-10-09',
        },
        at(9),
      );
      assert.deepEqual(
        database().transaction((tx) => readAnswers(tx, [])),
        {},
      );
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
