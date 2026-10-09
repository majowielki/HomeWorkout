/**
 * The day of the second engine, from the database to a running session (engine v2, 01 §3, P5.5).
 *
 * `previewDay` reads one consistent state, moves the block to today (writing
 * nothing) and plans the day. `acceptDay` does the same again inside the write
 * transaction, compares what it planned with the plan the person was shown,
 * and only when they are the same writes the block and starts the session:
 * the profile, the history, a request or the date having changed between the
 * preview and the acceptance is a conflict (`STALE_INPUT`), not a quiet
 * rebuild of what the person looked at.
 */
import { fingerprint } from '@/domain/fingerprint';
import type { CommandResult } from '@/domain/commands/result';
import type { BlockAdvance } from '@/domain/plan/block';
import { blockContextV2 } from '@/domain/plan/blockContext';
import { advanceBlockV2 } from '@/domain/plan/blockV2';
import { type DayInputV2, type DayOutputV2, planDayV2 } from '@/domain/plan/dayV2';
import type { PlanIntent } from '@/domain/policy/dayPolicy';
import { planVersions } from '@/domain/plan/versions';
import { trainingDate } from '@/domain/time/trainingDate';
import { db, type Tx } from '../client';
import { bumpRevision } from './ledger';
import { readDayBoundaryHour, readPlanningInputs } from './planningInputs';
import { sessionCommandStore, startSessionIn } from './sessionsV2';
import { readBlocks, type StoredBlock, writeBlockAdvance } from './trainingBlocks';

/** What the person asked for: the session id is made by the caller so the preview and the acceptance agree on it. */
export interface DayRequest {
  sessionId: string;
  intent?: PlanIntent;
  kind?: 'main' | 'extra';
  only?: DayInputV2['only'];
  acknowledged?: string[];
  /** The person asked for a deload today. */
  deloadRequested?: boolean;
}

export interface DayPreview {
  asOf: string;
  input: DayInputV2;
  current: StoredBlock | null;
  advance: BlockAdvance;
  output: DayOutputV2;
  /** The hash of the plan, when there is one: what an acceptance is checked against. */
  planHash: string | null;
}

/** Plans the day inside a transaction already open; writes nothing. */
export function planDayIn(tx: Tx, req: DayRequest, now: Date): DayPreview {
  const asOf = trainingDate(now, readDayBoundaryHour(tx));
  const { common, catalogVersion } = readPlanningInputs(tx, asOf);
  const { current, ended } = readBlocks(tx);
  const advance = advanceBlockV2(
    current?.state ?? null,
    blockContextV2({
      asOf,
      block: current?.state ?? null,
      records: common.records,
      daily: common.daily,
      slots: common.slots,
      catalog: common.catalog,
      eligibility: common.eligibility,
      preferences: common.preferences,
      models: common.models,
      recentBlocks: ended.map((b) => b.selections),
      deloadRequested: req.deloadRequested ?? false,
    }),
  );
  const inputs = { ...common, block: advance.block, request: req };
  const snapshot = fingerprint(inputs);
  const input: DayInputV2 = {
    asOf,
    intent: req.intent ?? 'auto_day',
    catalog: common.catalog,
    slots: common.slots,
    eligibility: common.eligibility,
    block: advance.block,
    records: common.records,
    rides: common.rides,
    daily: common.daily,
    constraints: common.constraints,
    week: common.week,
    preferences: common.preferences,
    models: common.models,
    ...(req.only === undefined ? {} : { only: req.only }),
    ...(req.acknowledged === undefined ? {} : { acknowledged: req.acknowledged }),
    session: {
      sessionId: req.sessionId,
      planRevision: 1,
      kind: req.kind ?? 'main',
      versions: planVersions(catalogVersion),
      snapshotFingerprint: snapshot,
      inputFingerprint: snapshot,
    },
  };
  const output = planDayV2(input);
  const result = output.result;
  return {
    asOf,
    input,
    current,
    advance,
    output,
    planHash:
      result.kind === 'ready' || result.kind === 'adjusted' ? result.plan.audit.planHash : null,
  };
}

/** The day as it would be planned now, for the person to look at. Writes nothing. */
export function previewDay(req: DayRequest, now: Date = new Date()): DayPreview {
  return db.transaction((tx) => planDayIn(tx, req, now));
}

export interface AcceptDayCommand {
  commandId: string;
  request: DayRequest;
  /** The hash of the plan the person was shown. */
  expectedPlanHash: string;
  timeZone: string | null;
}

/**
 * Starts the session of the day the person was shown. The day is planned again
 * from the database in the same transaction; a different plan is a conflict,
 * and the block moves only together with the session.
 */
export function acceptDay(
  cmd: AcceptDayCommand,
  now: Date = new Date(),
): CommandResult<{ sessionId: string }> {
  return sessionCommandStore.transact(cmd.commandId, (tx) => {
    const again = sessionCommandStore.replay<{ sessionId: string }>(tx, cmd.commandId);
    if (again) return again;
    const day = planDayIn(tx, cmd.request, now);
    const result = day.output.result;
    if (result.kind !== 'ready' && result.kind !== 'adjusted') {
      return {
        kind: 'rejected',
        code: 'INVALID_PLAN',
        detail: `no plan for the day: ${result.kind}`,
      };
    }
    if (day.planHash !== cmd.expectedPlanHash) {
      return {
        kind: 'conflict',
        code: 'STALE_INPUT',
        actualRevision: null,
        detail: day.planHash ?? undefined,
      };
    }
    const started = startSessionIn(
      tx,
      { commandId: cmd.commandId, plan: result.plan, timeZone: cmd.timeZone },
      now,
    );
    if (started.kind !== 'committed') return started;
    const moved =
      day.current === null ||
      day.advance.closed !== null ||
      JSON.stringify(day.current.state) !== JSON.stringify(day.advance.block);
    writeBlockAdvance(tx, day.current, day.advance, day.asOf, now);
    if (moved) bumpRevision(tx, 'block');
    return started;
  });
}
