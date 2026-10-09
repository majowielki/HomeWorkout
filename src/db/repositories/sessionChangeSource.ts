/** Fresh consultation inputs read through one SQLite transaction; no UI snapshot or cached actual. */
import { and, eq, isNull } from 'drizzle-orm';
import lexiconJson from '@data/movement-terms.json';
import { movementLexiconSchema } from '@data/movement-terms.schema';
import { fingerprint } from '@/domain/fingerprint';
import { addDays } from '@/domain/time/trainingDate';
import type { SessionPlan } from '@/domain/plan/plan';
import type { SessionChangeSnapshot } from '@/domain/session/types';
import { db, type Executor } from '../client';
import { plannedDays, trainingBlocks, workouts } from '../schema';
import { DAY_REASONS, type DayReason } from '@/domain/plan/reasons';
import { readPlanningInputs } from './planningInputs';

const lexicon = movementLexiconSchema.parse(lexiconJson);

export function readSessionChangeSource(tx: Executor, plan: SessionPlan) {
  const asOf = plan.trainingDate;
  const { common, history, catalogVersion } = readPlanningInputs(tx, asOf);
  const block = tx.select().from(trainingBlocks).where(isNull(trainingBlocks.closedOn)).get();
  const tomorrow = tx
    .select()
    .from(plannedDays)
    .where(eq(plannedDays.date, addDays(asOf, 1)))
    .get();
  const inputs = {
    ...common,
    lexicon,
    block:
      block === undefined
        ? {
            index: 1,
            startedOn: asOf,
            deloadFrom: null,
            deloadReason: null,
            selections: Object.fromEntries(
              plan.exposures
                .filter((e) => e.slotId !== null)
                .map((e) => [e.slotId!, e.exercise.id]),
            ),
          }
        : {
            index: block.blockIndex,
            startedOn: block.startedOn,
            deloadFrom: block.deloadFrom,
            deloadReason: block.deloadReason,
            selections: block.selections,
          },
    tomorrow:
      tomorrow?.selection == null
        ? null
        : {
            date: tomorrow.date,
            blockIndex: tomorrow.summary?.blockIndex ?? block?.blockIndex ?? 1,
            phase: tomorrow.summary?.phase ?? 'work',
            items: tomorrow.selection.map((item) => ({ ...item, role: 'work' as const })),
            skipped: [],
            dayReasons: (tomorrow.summary?.dayReasons ?? []).filter((code): code is DayReason =>
              (DAY_REASONS as readonly string[]).includes(code),
            ),
          },
  };
  const snapshotFingerprint = fingerprint(inputs);
  const snap: SessionChangeSnapshot = {
    ...inputs,
    session: {
      sessionId: plan.sessionId,
      planRevision: plan.planRevision,
      kind: plan.kind === 'extra' ? 'extra' : 'main',
      versions: { ...plan.versions, catalog: catalogVersion },
      snapshotFingerprint,
      inputFingerprint: snapshotFingerprint,
    },
  };
  return {
    snap,
    session: { plan, records: history.records.filter((r) => r.sessionId === plan.sessionId) },
    // A flaw in an older session, say from an edited backup, must not shut off the running one.
    problems: history.problems.filter(
      (p) => p.sessionId === null || p.sessionId === plan.sessionId,
    ),
  };
}

/** Read-only preview boundary. Acceptance uses the same builder again inside its write transaction. */
export function loadSessionChangeSource(sessionId: string) {
  return db.transaction((tx) => {
    const row = tx.select().from(workouts).where(eq(workouts.id, sessionId)).get();
    if (row?.planSchema !== 2 || row.sessionPlan === null) return null;
    return readSessionChangeSource(tx, row.sessionPlan);
  });
}

/** The workout under way, if it is a session of engine: the reading the session tools consult. */
export function loadActiveSessionSource() {
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(workouts)
      .where(and(eq(workouts.status, 'in_progress'), eq(workouts.planSchema, 2)))
      .get();
    return row?.sessionPlan ? readSessionChangeSource(tx, row.sessionPlan) : null;
  });
}
