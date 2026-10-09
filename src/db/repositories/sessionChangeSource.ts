/** Fresh consultation inputs read through one SQLite transaction; no UI snapshot or cached actual. */
import { and, eq, isNull } from 'drizzle-orm';
import lexiconJson from '@data/movement-terms.json';
import { movementLexiconSchema } from '@data/movement-terms.schema';
import { fingerprint } from '@/domain/fingerprint';
import { addDays } from '@/domain/time/trainingDate';
import type { SessionPlanV2 } from '@/domain/plan/planV2';
import type { SessionChangeSnapshot } from '@/domain/session/types';
import { db, type Executor } from '../client';
import { plannedDays, trainingBlocks, workouts } from '../schema';
import { readPlanningInputs } from './planningInputs';

const lexicon = movementLexiconSchema.parse(lexiconJson);

export function readSessionChangeSource(tx: Executor, plan: SessionPlanV2) {
  const asOf = plan.trainingDate;
  const { common, history, catalogVersion } = readPlanningInputs(tx, asOf);
  const block = tx.select().from(trainingBlocks).where(isNull(trainingBlocks.closedOn)).get();
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
      tx
        .select()
        .from(plannedDays)
        .where(and(eq(plannedDays.date, addDays(asOf, 1)), eq(plannedDays.seq, 1)))
        .get()?.selection ?? null,
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
    problems: history.problems,
  };
}

/** Read-only preview boundary. Acceptance uses the same builder again inside its write transaction. */
export function loadSessionChangeSource(sessionId: string) {
  return db.transaction((tx) => {
    const row = tx.select().from(workouts).where(eq(workouts.id, sessionId)).get();
    if (row?.planSchema !== 2 || row.planV2 === null) return null;
    return readSessionChangeSource(tx, row.planV2);
  });
}

/** The workout under way, if it is a session of engine v2: the reading the session tools consult. */
export function loadActiveSessionSource() {
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(workouts)
      .where(and(eq(workouts.status, 'in_progress'), eq(workouts.planSchema, 2)))
      .get();
    return row?.planV2 ? readSessionChangeSource(tx, row.planV2) : null;
  });
}
