import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { CommandResult } from '@/domain/commands/result';
import type { ExposureOutcome } from '@/domain/observations/exposure';
import { exposureOutcome } from '@/domain/observations/outcome';
import { setLogColumns } from '@/domain/observations/project';
import {
  type SetDispositionStatus,
  type SetObservation,
  setObservationSchema,
} from '@/domain/observations/types';
import { type SessionPlan, sessionPlanSchema } from '@/domain/plan/plan';
import type { StoredResult } from '@/domain/session/progress';

import { db, type Tx } from '../client';
import {
  bands,
  exposureOutcomes,
  feelReports,
  plannedDays,
  sessionPlanRevisions,
  setDispositions,
  setLogRevisions,
  setLogs,
  workouts,
} from '../schema';
import { bumpRevision, findCommand, recordCommand } from './ledger';
import { historyPlans } from './history';

/*
 * The write side of a session of engine (02 §6, 13 §14).
 *
 * Every function is one command: it carries a `commandId`, checks it against
 * the ledger, validates, writes everything it changes — the result, the
 * counters, the projection of the exposure's outcome, the ledger entry — in
 * ONE transaction, and answers with a `CommandResult`. A screen advances only
 * on `committed`; after a lost answer it sends the same command again and
 * gets the stored answer. Nothing is validated against anything in memory:
 * the plan, the results and the revisions all come from the database in the
 * same transaction that writes.
 */

type WorkoutRow = typeof workouts.$inferSelect;
type SetRow = typeof setLogs.$inferSelect;

/** What a command stores in the ledger, so a repeat can answer with it. */
interface Stored<T> {
  result: T;
  sessionRevision: number;
}

function transact<T>(commandId: string, run: (tx: Tx) => CommandResult<T>): CommandResult<T> {
  try {
    return db.transaction(run);
  } catch (error) {
    return {
      kind: 'storage_error',
      retryable: true,
      commandId,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The answer a command already gave, when it was given before. */
function replay<T>(tx: Tx, commandId: string): CommandResult<T> | null {
  const known = findCommand(tx, commandId);
  if (known === null) return null;
  const stored = known.result as Stored<T>;
  return {
    kind: 'already_committed',
    result: stored.result,
    sessionRevision: stored.sessionRevision,
  };
}

function commit<T>(
  tx: Tx,
  entry: { commandId: string; kind: string; workoutId: string },
  result: T,
  now: Date,
): CommandResult<T> {
  const sessionRevision = tx
    .select({ revision: workouts.revision })
    .from(workouts)
    .where(eq(workouts.id, entry.workoutId))
    .get()!.revision;
  recordCommand(tx, { ...entry, result: { result, sessionRevision } satisfies Stored<T> }, now);
  return { kind: 'committed', result, sessionRevision };
}

const workoutOf = (tx: Tx, sessionId: string): WorkoutRow | undefined =>
  tx.select().from(workouts).where(eq(workouts.id, sessionId)).get();

/** The session a command acts on: a session of engine, and running unless the command is a correction. */
function sessionFor(
  tx: Tx,
  sessionId: string,
  needsRunning: boolean,
):
  | { ok: true; workout: WorkoutRow; plan: SessionPlan }
  | { ok: false; result: CommandResult<never> } {
  const workout = workoutOf(tx, sessionId);
  if (workout === undefined || workout.planSchema !== 2 || workout.sessionPlan === null) {
    return {
      ok: false,
      result: {
        kind: 'rejected',
        code: 'UNKNOWN_SESSION',
        detail: `no session of engine ${sessionId}`,
      },
    };
  }
  if (needsRunning && workout.status !== 'in_progress') {
    return {
      ok: false,
      result: {
        kind: 'rejected',
        code: 'SESSION_NOT_ACTIVE',
        detail: `${sessionId} is ${workout.status}`,
      },
    };
  }
  return { ok: true, workout, plan: workout.sessionPlan };
}

const raiseSession = (tx: Tx, sessionId: string): void => {
  tx.update(workouts)
    .set({ revision: sql`${workouts.revision} + 1` })
    .where(eq(workouts.id, sessionId))
    .run();
};

// ---------------------------------------------------------------- outcomes

/** What is stored for each planned set of a session, as the states an outcome is counted from. */
function setStates(tx: Tx, sessionId: string): Map<string, SetDispositionStatus> {
  const states = new Map<string, SetDispositionStatus>();
  const skips = tx
    .select()
    .from(setDispositions)
    .where(eq(setDispositions.workoutId, sessionId))
    .all();
  for (const d of skips) states.set(d.plannedSetId, d.status);
  const results = tx
    .select({ plannedSetId: setLogs.plannedSetId, observation: setLogs.observation })
    .from(setLogs)
    .where(and(eq(setLogs.workoutId, sessionId), isNull(setLogs.deletedAt)))
    .all();
  // A result wins over a skip of the same set.
  for (const r of results) {
    if (r.plannedSetId !== null && r.observation !== null)
      states.set(r.plannedSetId, r.observation.status);
  }
  return states;
}

/** A session as the screen that runs it reads it: the plan, what became of each set, and the results. */
export interface SessionState {
  workout: {
    id: string;
    trainingDate: string;
    status: WorkoutRow['status'];
    startedAt: string;
    finishedAt: string | null;
    sessionRpe: number | null;
    notes: string | null;
    /** The counter every command of the session is checked against. */
    revision: number;
  };
  plan: SessionPlan;
  states: Map<string, SetDispositionStatus>;
  /** The current result of each planned set that has one, with the row it is stored in. */
  results: Map<string, StoredResult>;
}

/** The session with that id, if it is a session of the engine. One consistent read. */
export function readSessionState(sessionId: string): SessionState | null {
  return db.transaction((tx) => {
    const workout = workoutOf(tx, sessionId);
    if (workout === undefined || workout.planSchema !== 2 || workout.sessionPlan === null)
      return null;
    const results: SessionState['results'] = new Map();
    const rows = tx
      .select()
      .from(setLogs)
      .where(and(eq(setLogs.workoutId, sessionId), isNull(setLogs.deletedAt)))
      .all();
    for (const row of rows) {
      if (row.plannedSetId !== null && row.observation !== null) {
        results.set(row.plannedSetId, {
          id: row.id,
          revision: row.revision,
          observation: row.observation,
        });
      }
    }
    return {
      workout: {
        id: workout.id,
        trainingDate: workout.trainingDate,
        status: workout.status,
        startedAt: workout.startedAt,
        finishedAt: workout.finishedAt,
        sessionRpe: workout.sessionRpe,
        notes: workout.notes,
        revision: workout.revision,
      },
      plan: workout.sessionPlan,
      states: setStates(tx, sessionId),
      results,
    };
  });
}

/** Rebuilds the stored outcomes of a session from its plan and what is stored for it. */
function refreshOutcomes(
  tx: Tx,
  workout: WorkoutRow,
  plan: SessionPlan,
  historyRevision: number,
): void {
  const states = setStates(tx, workout.id);
  const closed = workout.status !== 'in_progress';
  tx.delete(exposureOutcomes).where(eq(exposureOutcomes.workoutId, workout.id)).run();
  const rows = historyPlans(tx, [{ ...workout, sessionPlan: plan }])[0]!.exposures.map((exposure) =>
    exposureOutcome(
      exposure,
      states,
      { planRevision: workout.planRevision, historyRevision },
      closed,
    ),
  );
  if (rows.length > 0) {
    tx.insert(exposureOutcomes)
      .values(rows.map((o) => ({ workoutId: workout.id, ...o })))
      .run();
  }
}

/** Shared transaction/ledger/session boundary for application commands. */
export const sessionCommandStore = { transact, replay, commit, sessionFor, touch };

/** A session changed: its counter, the history counter, and the outcomes that follow. */
function touch(tx: Tx, sessionId: string): void {
  raiseSession(tx, sessionId);
  const history = bumpRevision(tx, 'history');
  const workout = workoutOf(tx, sessionId)!;
  refreshOutcomes(tx, workout, workout.sessionPlan!, history);
}

// ------------------------------------------------------------------- start

export interface StartSessionCommand {
  commandId: string;
  plan: SessionPlan;
  timeZone: string | null;
}

/**
 * Freezes a plan of engine into a running session inside a transaction that
 * is already open: the ledger has been checked by the caller. Only one session
 * runs at a time.
 */
export function startSessionIn(
  tx: Tx,
  cmd: StartSessionCommand,
  now: Date,
): CommandResult<{ sessionId: string }> {
  const parsed = sessionPlanSchema.safeParse(cmd.plan);
  if (!parsed.success) {
    return { kind: 'rejected', code: 'INVALID_PLAN', detail: z.prettifyError(parsed.error) };
  }
  const plan = parsed.data;
  const running = tx
    .select({ id: workouts.id })
    .from(workouts)
    .where(eq(workouts.status, 'in_progress'))
    .get();
  if (running) {
    return {
      kind: 'conflict',
      code: 'ACTIVE_SESSION_EXISTS',
      actualRevision: null,
      detail: running.id,
    };
  }
  tx.insert(workouts)
    .values({
      id: plan.sessionId,
      trainingDate: plan.trainingDate,
      startedAt: now.toISOString(),
      status: 'in_progress',
      plan: null,
      planSchema: 2,
      sessionPlan: plan,
      planRevision: plan.planRevision,
      revision: 0,
      timeZone: cmd.timeZone,
    })
    .run();
  tx.insert(sessionPlanRevisions)
    .values({
      workoutId: plan.sessionId,
      planRevision: plan.planRevision,
      plan,
      reason: 'start',
      channel: 'engine',
      overrides: plan.audit.overrides,
      createdAt: now.toISOString(),
    })
    .run();
  touch(tx, plan.sessionId);
  return commit(
    tx,
    { commandId: cmd.commandId, kind: 'start_session', workoutId: plan.sessionId },
    { sessionId: plan.sessionId },
    now,
  );
}

/** Freezes a plan of engine into a running session. Only one session runs at a time. */
export function startSession(
  cmd: StartSessionCommand,
  now: Date = new Date(),
): CommandResult<{ sessionId: string }> {
  return transact(cmd.commandId, (tx) => {
    const again = replay<{ sessionId: string }>(tx, cmd.commandId);
    if (again) return again;
    return startSessionIn(tx, cmd, now);
  });
}

// -------------------------------------------------------------------- log

export interface LogSetCommand {
  commandId: string;
  sessionId: string;
  /** The set of the plan this result is for; null for a set beyond the plan. */
  plannedSetId: string | null;
  /** For a set beyond the plan: what it was, and why it is there. */
  extra?: {
    exerciseId: string;
    exposureId: string | null;
    source: 'extra' | 'user_override';
  };
  expectedSessionRevision: number;
  observation: Pick<
    SetObservation,
    'status' | 'amount' | 'resistance' | 'rir' | 'shortfall' | 'performedAt'
  >;
}

export interface LoggedSet {
  observationId: string;
}

/**
 * Records the result of one set (13 §14). The same command twice records it
 * once; a second *different* command for a set that has a result is a
 * conflict, because correcting a result is `updateSet`.
 */
export function logSet(cmd: LogSetCommand, now: Date = new Date()): CommandResult<LoggedSet> {
  return transact(cmd.commandId, (tx) => {
    const again = replay<LoggedSet>(tx, cmd.commandId);
    if (again) {
      // The result this command wrote may have been taken back since: it is not there to return.
      const written = tx.select().from(setLogs).where(eq(setLogs.commandId, cmd.commandId)).get();
      if (written?.deletedAt) {
        return { kind: 'conflict', code: 'COMMAND_SUPERSEDED', actualRevision: null } as const;
      }
      return again;
    }
    const found = sessionFor(tx, cmd.sessionId, true);
    if (!found.ok) return found.result;
    const { workout, plan } = found;
    if (workout.revision !== cmd.expectedSessionRevision) {
      return {
        kind: 'conflict',
        code: 'SESSION_CHANGED',
        actualRevision: workout.revision,
      } as const;
    }

    // What the result is for.
    let exposureIndex = plan.exposures.length;
    let exposureId: string | null = cmd.extra?.exposureId ?? null;
    let logicalSetId: string | null = null;
    let side: SetObservation['side'] = null;
    let exerciseId = cmd.extra?.exerciseId ?? '';
    let role: string | null = null;
    let comparisonKey: string | null = null;
    let scope: 'primary' | 'supplemental' | 'none' | null = null;
    let ordinal = 1;
    let source: 'plan' | 'user_override' | 'extra' = cmd.extra?.source ?? 'extra';
    if (cmd.plannedSetId !== null) {
      exposureIndex = plan.exposures.findIndex((e) =>
        e.sets.some((s) => s.id === cmd.plannedSetId),
      );
      const exposure = plan.exposures[exposureIndex];
      const planned = exposure?.sets.find((s) => s.id === cmd.plannedSetId);
      if (exposure === undefined || planned === undefined) {
        return {
          kind: 'rejected',
          code: 'UNKNOWN_PLANNED_SET',
          detail: `${cmd.plannedSetId} is not in the plan of ${cmd.sessionId}`,
        } as const;
      }
      const existing = tx
        .select({ id: setLogs.id })
        .from(setLogs)
        .where(
          and(
            eq(setLogs.workoutId, cmd.sessionId),
            eq(setLogs.plannedSetId, cmd.plannedSetId),
            isNull(setLogs.deletedAt),
          ),
        )
        .get();
      if (existing) {
        return {
          kind: 'conflict',
          code: 'SET_ALREADY_RECORDED',
          actualRevision: workout.revision,
          detail: cmd.plannedSetId,
        } as const;
      }
      exposureId = exposure.id;
      logicalSetId = planned.logicalSetId;
      side = planned.side;
      exerciseId = exposure.exercise.id;
      role = planned.role;
      comparisonKey = exposure.comparisonKey;
      scope = exposure.progressionScope;
      ordinal = planned.ordinal;
      source = 'plan';
    } else if (cmd.extra === undefined) {
      return {
        kind: 'rejected',
        code: 'INVALID_COMMAND',
        detail: 'a set beyond the plan says what it is',
      } as const;
    }

    const id = `obs-${cmd.commandId}`;
    const candidate = {
      id,
      commandId: cmd.commandId,
      revision: 1,
      sessionId: cmd.sessionId,
      exposureId,
      plannedSetId: cmd.plannedSetId,
      logicalSetId,
      side,
      recordedAt: now.toISOString(),
      ...cmd.observation,
    };
    const parsed = setObservationSchema.safeParse(candidate);
    if (!parsed.success) {
      return {
        kind: 'rejected',
        code: 'INVALID_COMMAND',
        detail: z.prettifyError(parsed.error),
      } as const;
    }
    const observation = parsed.data;
    const columns = setLogColumns(observation);

    tx.insert(setLogs)
      .values({
        id,
        workoutId: cmd.sessionId,
        exerciseId,
        exerciseOrder: exposureIndex,
        setIndex: ordinal,
        isWarmup: role === 'warmup',
        reps: columns.reps,
        timeSec: columns.timeSec,
        rir: columns.rir,
        weightKg: columns.weightKg,
        dumbbellMode: columns.dumbbellMode,
        bandId: columns.bandId,
        anchorPosition: columns.anchorPosition,
        estimatedLoadKg: null,
        side: columns.side,
        shortfall: observation.shortfall,
        loggedAt: now.toISOString(),
        commandId: cmd.commandId,
        plannedSetId: cmd.plannedSetId,
        exposureId,
        logicalSetId,
        role,
        comparisonKey,
        progressionScope: scope,
        source,
        performedOn: workout.trainingDate,
        revision: 1,
        deletedAt: null,
        observation,
      })
      .run();
    // The person did it after all: a skip of the same set is no longer true.
    if (cmd.plannedSetId !== null) {
      tx.delete(setDispositions)
        .where(
          and(
            eq(setDispositions.workoutId, cmd.sessionId),
            eq(setDispositions.plannedSetId, cmd.plannedSetId),
          ),
        )
        .run();
    }
    // The wear of a band, once for each new result and never for a retry (02 §6, step 5).
    if (columns.bandId !== null && columns.reps) {
      tx.update(bands)
        .set({ cycleCount: sql`${bands.cycleCount} + ${columns.reps}` })
        .where(eq(bands.id, columns.bandId))
        .run();
    }
    touch(tx, cmd.sessionId);
    return commit(
      tx,
      { commandId: cmd.commandId, kind: 'log_set', workoutId: cmd.sessionId },
      { observationId: id },
      now,
    );
  });
}

// ------------------------------------------------------------------- skip

export interface SkipSetsCommand {
  commandId: string;
  sessionId: string;
  plannedSetIds: readonly string[];
  reason: 'user_skipped' | 'equipment_unavailable' | 'pain' | 'time' | 'replaced';
  expectedSessionRevision: number;
}

/** Records that sets were not done, and why. Writes no result for them (02 §3: no result from a plan). */
export function skipSets(
  cmd: SkipSetsCommand,
  now: Date = new Date(),
): CommandResult<{ skipped: string[] }> {
  return transact(cmd.commandId, (tx) => {
    const again = replay<{ skipped: string[] }>(tx, cmd.commandId);
    if (again) return again;
    const found = sessionFor(tx, cmd.sessionId, true);
    if (!found.ok) return found.result;
    const { workout, plan } = found;
    if (workout.revision !== cmd.expectedSessionRevision) {
      return {
        kind: 'conflict',
        code: 'SESSION_CHANGED',
        actualRevision: workout.revision,
      } as const;
    }
    const planned = new Set(plan.exposures.flatMap((e) => e.sets.map((s) => s.id)));
    const unknown = cmd.plannedSetIds.filter((id) => !planned.has(id));
    if (cmd.plannedSetIds.length === 0 || unknown.length > 0) {
      return {
        kind: 'rejected',
        code: 'UNKNOWN_PLANNED_SET',
        detail: unknown.length > 0 ? unknown.join(', ') : 'no sets to skip',
      } as const;
    }
    const done = setStates(tx, cmd.sessionId);
    const withResult = cmd.plannedSetIds.filter((id) => {
      const state = done.get(id);
      return state === 'performed' || state === 'interrupted';
    });
    if (withResult.length > 0) {
      return {
        kind: 'conflict',
        code: 'SET_ALREADY_RECORDED',
        actualRevision: workout.revision,
        detail: withResult.join(', '),
      } as const;
    }
    for (const plannedSetId of new Set(cmd.plannedSetIds)) {
      tx.insert(setDispositions)
        .values({
          workoutId: cmd.sessionId,
          plannedSetId,
          status: 'skipped',
          reason: cmd.reason,
          commandId: cmd.commandId,
          at: now.toISOString(),
        })
        .onConflictDoUpdate({
          target: [setDispositions.workoutId, setDispositions.plannedSetId],
          set: {
            status: 'skipped',
            reason: cmd.reason,
            commandId: cmd.commandId,
            at: now.toISOString(),
          },
        })
        .run();
    }
    touch(tx, cmd.sessionId);
    return commit(
      tx,
      { commandId: cmd.commandId, kind: 'skip_sets', workoutId: cmd.sessionId },
      { skipped: [...new Set(cmd.plannedSetIds)] },
      now,
    );
  });
}

export interface ReopenSetsCommand {
  commandId: string;
  sessionId: string;
  plannedSetIds: readonly string[];
}

/** Takes a skip back: the sets are to be done again, as if they had never been passed over. */
export function reopenSets(
  cmd: ReopenSetsCommand,
  now: Date = new Date(),
): CommandResult<{ reopened: string[] }> {
  return transact(cmd.commandId, (tx) => {
    const again = replay<{ reopened: string[] }>(tx, cmd.commandId);
    if (again) return again;
    const found = sessionFor(tx, cmd.sessionId, true);
    if (!found.ok) return found.result;
    const ids = [...new Set(cmd.plannedSetIds)];
    for (const plannedSetId of ids) {
      tx.delete(setDispositions)
        .where(
          and(
            eq(setDispositions.workoutId, cmd.sessionId),
            eq(setDispositions.plannedSetId, plannedSetId),
            eq(setDispositions.status, 'skipped'),
          ),
        )
        .run();
    }
    touch(tx, cmd.sessionId);
    return commit(
      tx,
      { commandId: cmd.commandId, kind: 'reopen_sets', workoutId: cmd.sessionId },
      { reopened: ids },
      now,
    );
  });
}

// ---------------------------------------------------------------- correct

export interface UpdateSetCommand {
  commandId: string;
  sessionId: string;
  observationId: string;
  /** The revision of the result the correction was made from. */
  expectedObservationRevision: number;
  patch: Partial<Pick<SetObservation, 'amount' | 'resistance' | 'rir' | 'shortfall'>>;
}

/** Corrects a result, keeping what it replaces. Works on a finished session too: history can be fixed. */
export function updateSet(
  cmd: UpdateSetCommand,
  now: Date = new Date(),
): CommandResult<{ observationId: string; revision: number }> {
  return transact(cmd.commandId, (tx) => {
    const again = replay<{ observationId: string; revision: number }>(tx, cmd.commandId);
    if (again) return again;
    const found = sessionFor(tx, cmd.sessionId, false);
    if (!found.ok) return found.result;
    const row = currentRow(tx, cmd.sessionId, cmd.observationId);
    if (row === undefined || row.observation === null) {
      return {
        kind: 'rejected',
        code: 'UNKNOWN_OBSERVATION',
        detail: `no current result ${cmd.observationId} in ${cmd.sessionId}`,
      } as const;
    }
    if (row.revision !== cmd.expectedObservationRevision) {
      return {
        kind: 'conflict',
        code: 'STALE_INPUT',
        actualRevision: row.revision,
        detail: 'the result was corrected since',
      } as const;
    }
    const parsed = setObservationSchema.safeParse({
      ...row.observation,
      ...cmd.patch,
      revision: row.revision + 1,
      recordedAt: now.toISOString(),
    });
    if (!parsed.success) {
      return {
        kind: 'rejected',
        code: 'INVALID_COMMAND',
        detail: z.prettifyError(parsed.error),
      } as const;
    }
    const observation = parsed.data;
    const columns = setLogColumns(observation);
    tx.insert(setLogRevisions)
      .values({
        setLogId: row.id,
        revision: row.revision,
        payload: row.observation,
        replacedAt: now.toISOString(),
      })
      .run();
    tx.update(setLogs)
      .set({
        reps: columns.reps,
        timeSec: columns.timeSec,
        rir: columns.rir,
        weightKg: columns.weightKg,
        dumbbellMode: columns.dumbbellMode,
        bandId: columns.bandId,
        anchorPosition: columns.anchorPosition,
        shortfall: observation.shortfall,
        revision: observation.revision,
        observation,
      })
      .where(eq(setLogs.id, row.id))
      .run();
    touch(tx, cmd.sessionId);
    return commit(
      tx,
      { commandId: cmd.commandId, kind: 'update_set', workoutId: cmd.sessionId },
      { observationId: row.id, revision: observation.revision },
      now,
    );
  });
}

export interface UndoSetCommand {
  commandId: string;
  sessionId: string;
  observationId: string;
}

/** Takes a result back. The row stays as a tombstone, so the command that wrote it cannot write it again (T18). */
export function undoSet(
  cmd: UndoSetCommand,
  now: Date = new Date(),
): CommandResult<{ observationId: string; plannedSetId: string | null }> {
  return transact(cmd.commandId, (tx) => {
    const again = replay<{ observationId: string; plannedSetId: string | null }>(tx, cmd.commandId);
    if (again) return again;
    const found = sessionFor(tx, cmd.sessionId, false);
    if (!found.ok) return found.result;
    const row = currentRow(tx, cmd.sessionId, cmd.observationId);
    if (row === undefined) {
      return {
        kind: 'rejected',
        code: 'UNKNOWN_OBSERVATION',
        detail: `no current result ${cmd.observationId} in ${cmd.sessionId}`,
      } as const;
    }
    tx.insert(setLogRevisions)
      .values({
        setLogId: row.id,
        revision: row.revision,
        payload: row.observation,
        replacedAt: now.toISOString(),
      })
      .run();
    tx.update(setLogs)
      .set({ deletedAt: now.toISOString(), revision: row.revision + 1 })
      .where(eq(setLogs.id, row.id))
      .run();
    touch(tx, cmd.sessionId);
    return commit(
      tx,
      { commandId: cmd.commandId, kind: 'undo_set', workoutId: cmd.sessionId },
      { observationId: row.id, plannedSetId: row.plannedSetId },
      now,
    );
  });
}

function currentRow(tx: Tx, sessionId: string, observationId: string): SetRow | undefined {
  return tx
    .select()
    .from(setLogs)
    .where(
      and(
        eq(setLogs.id, observationId),
        eq(setLogs.workoutId, sessionId),
        isNull(setLogs.deletedAt),
      ),
    )
    .get();
}

// ------------------------------------------------------------------- feel

export interface FeelCommand {
  commandId: string;
  sessionId: string;
  exposureId: string | null;
  feel: 'too_hard' | 'too_easy';
  channel: 'touch' | 'voice' | 'ai_proposal';
}

export const feelCommandSchema = z.strictObject({
  commandId: z.string().min(1),
  sessionId: z.string().min(1),
  exposureId: z.string().min(1).nullable(),
  feel: z.enum(['too_hard', 'too_easy']),
  channel: z.enum(['touch', 'voice', 'ai_proposal']),
});

/** Shared write inside the caller's transaction; a feel report is a history input. */
export function persistFeelReport(tx: Tx, cmd: FeelCommand, now: Date): string {
  const id = `feel-${cmd.commandId}`;
  tx.insert(feelReports)
    .values({
      id,
      workoutId: cmd.sessionId,
      exposureId: cmd.exposureId,
      feel: cmd.feel,
      channel: cmd.channel,
      commandId: cmd.commandId,
      at: now.toISOString(),
    })
    .run();
  touch(tx, cmd.sessionId);
  return id;
}

/** "Too hard" / "too easy", said during a session: context for the next prescription; it changes no plan (11 §7). */
export function recordFeel(
  cmd: FeelCommand,
  now: Date = new Date(),
): CommandResult<{ id: string }> {
  return transact(cmd.commandId, (tx) => {
    const known = findCommand(tx, cmd.commandId);
    if (known !== null && (known.kind !== 'feel' || known.workoutId !== cmd.sessionId))
      return {
        kind: 'rejected',
        code: 'INVALID_COMMAND',
        detail: 'command id belongs to another operation',
      };
    const again = replay<{ id: string }>(tx, cmd.commandId);
    if (again) return again;
    const parsed = feelCommandSchema.safeParse(cmd);
    if (!parsed.success)
      return { kind: 'rejected', code: 'INVALID_COMMAND', detail: z.prettifyError(parsed.error) };
    const found = sessionFor(tx, cmd.sessionId, true);
    if (!found.ok) return found.result;
    if (cmd.exposureId !== null && !found.plan.exposures.some((e) => e.id === cmd.exposureId)) {
      return {
        kind: 'rejected',
        code: 'INVALID_COMMAND',
        detail: `${cmd.exposureId} is not an exposure of ${cmd.sessionId}`,
      } as const;
    }
    const id = persistFeelReport(tx, cmd, now);
    return commit(
      tx,
      { commandId: cmd.commandId, kind: 'feel', workoutId: cmd.sessionId },
      { id },
      now,
    );
  });
}

// ------------------------------------------------------------------ close

export interface CloseSessionCommand {
  commandId: string;
  sessionId: string;
  how: 'completed' | 'abandoned';
  sessionRpe?: number | null;
  notes?: string | null;
}

export interface Closed {
  status: 'completed' | 'abandoned';
  outcomes: ExposureOutcome[];
}

/**
 * Closes the session. Closing records nothing about sets that were not done:
 * they stay without a result, and the outcomes read them as skipped (02 §4).
 * A session that ends with sets undone is `completed`, not `fully done`.
 */
export function closeSession(
  cmd: CloseSessionCommand,
  now: Date = new Date(),
): CommandResult<Closed> {
  return transact(cmd.commandId, (tx) => {
    const again = replay<Closed>(tx, cmd.commandId);
    if (again) return again;
    const found = sessionFor(tx, cmd.sessionId, true);
    if (!found.ok) return found.result;
    const at = now.toISOString();
    tx.update(workouts)
      .set({
        status: cmd.how,
        finishedAt: at,
        sessionRpe: cmd.sessionRpe ?? null,
        notes: cmd.notes ?? null,
      })
      .where(eq(workouts.id, cmd.sessionId))
      .run();
    if (found.plan.kind === 'main') {
      tx.update(plannedDays)
        .set({ status: cmd.how === 'completed' ? 'done' : 'missed', updatedAt: at })
        .where(eq(plannedDays.date, found.workout.trainingDate))
        .run();
    }
    touch(tx, cmd.sessionId);
    const outcomes = tx
      .select()
      .from(exposureOutcomes)
      .where(eq(exposureOutcomes.workoutId, cmd.sessionId))
      .all()
      .map(({ workoutId: _workoutId, ...outcome }) => outcome);
    return commit(
      tx,
      { commandId: cmd.commandId, kind: 'close_session', workoutId: cmd.sessionId },
      { status: cmd.how, outcomes },
      now,
    );
  });
}
