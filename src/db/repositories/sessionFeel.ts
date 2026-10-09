/** Record a report and return options based on the resulting history in one transaction. */
import { z } from 'zod';
import type { CommandResult } from '@/domain/commands/result';
import { sessionPlanV2Schema } from '@/domain/plan/planV2';
import { assessSessionChange } from '@/domain/session/assess';
import type { ChangeAssessment } from '@/domain/session/types';
import { findCommand, readRevision } from './ledger';
import { readSessionChangeSource } from './sessionChangeSource';
import {
  feelCommandSchema,
  persistFeelReport,
  sessionCommandStore as store,
  type FeelCommand,
} from './sessionsV2';

export interface ReportSessionFeelCommand extends FeelCommand {
  expected: { planRevision: number; historyRevision: number };
}

export interface ReportedSessionFeel {
  id: string;
  assessment: ChangeAssessment;
}

const commandSchema = feelCommandSchema.extend({
  expected: z.strictObject({
    planRevision: z.number().int().positive(),
    historyRevision: z.number().int().nonnegative(),
  }),
});

export function reportSessionFeel(
  cmd: ReportSessionFeelCommand,
  now: Date = new Date(),
): CommandResult<ReportedSessionFeel> {
  return store.transact(cmd.commandId, (tx) => {
    const known = findCommand(tx, cmd.commandId);
    if (known !== null && (known.kind !== 'session_feel' || known.workoutId !== cmd.sessionId))
      return {
        kind: 'rejected',
        code: 'INVALID_COMMAND',
        detail: 'command id belongs to another operation',
      };
    const again = store.replay<ReportedSessionFeel>(tx, cmd.commandId);
    if (again) return again;
    const parsed = commandSchema.safeParse(cmd);
    if (!parsed.success)
      return { kind: 'rejected', code: 'INVALID_COMMAND', detail: z.prettifyError(parsed.error) };
    const found = store.sessionFor(tx, cmd.sessionId, true);
    if (!found.ok) return found.result;
    const { workout, plan } = found;
    if (!sessionPlanV2Schema.safeParse(plan).success || plan.planRevision !== workout.planRevision)
      return {
        kind: 'rejected',
        code: 'INVALID_PLAN',
        detail: 'stored plan schema or revision is invalid',
      };
    if (
      workout.planRevision !== cmd.expected.planRevision ||
      readRevision(tx, 'history') !== cmd.expected.historyRevision
    )
      return {
        kind: 'conflict',
        code: 'STALE_INPUT',
        actualRevision: workout.planRevision,
        detail: 'plan or history revision changed',
      };
    if (cmd.exposureId !== null && !plan.exposures.some((e) => e.id === cmd.exposureId))
      return { kind: 'rejected', code: 'INVALID_COMMAND', detail: 'unknown exposure' };
    // Validate the read before writing. Failures after the insert throw and roll back every table.
    const before = readSessionChangeSource(tx, plan);
    if (before.problems.length > 0)
      return { kind: 'rejected', code: 'INVALID_PLAN', detail: JSON.stringify(before.problems) };
    const id = persistFeelReport(tx, cmd, now);
    const source = readSessionChangeSource(tx, plan);
    const assessment = assessSessionChange(source.snap, source.session, {
      kind: 'feel',
      exposureId: cmd.exposureId,
      feel: cmd.feel,
    });
    return store.commit(
      tx,
      { commandId: cmd.commandId, kind: 'session_feel', workoutId: cmd.sessionId },
      { id, assessment },
      now,
    );
  });
}
