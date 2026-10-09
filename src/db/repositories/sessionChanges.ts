import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { CommandResult } from '@/domain/commands/result';
import { compareCodePoints } from '@/domain/fingerprint';
import { stampPlan } from '@/domain/plan/compile';
import { sessionPlanSchema } from '@/domain/plan/plan';
import { adviceToAcknowledge, RULE_CODES, type RuleCode } from '@/domain/policy/hardAdvice';
import { assessSessionChange } from '@/domain/session/assess';
import type { SessionChange } from '@/domain/session/types';
import { sessionPlanRevisions, setDispositions, workouts } from '../schema';
import { findCommand, readRevision } from './ledger';
import { readSessionChangeSource } from './sessionChangeSource';
import { sessionCommandStore as store } from './sessions';

export interface ApplySessionChangeCommand {
  commandId: string;
  sessionId: string;
  patchId: string;
  /** Hashes are not reversible: carry the exact intent, never a client-supplied plan or patch ops. */
  change: SessionChange;
  expected: { planRevision: number; historyRevision: number };
  acknowledged: readonly RuleCode[];
  channel: 'touch' | 'voice' | 'ai_proposal';
}

const ref = z.union([
  z.strictObject({ id: z.string().min(1) }),
  z.strictObject({ query: z.string() }),
]);
const changeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('add_exercise'),
    exercise: ref,
    sets: z.number().optional(),
    position: z.enum(['next', 'end']).optional(),
  }),
  z.strictObject({ kind: z.literal('add_sets'), exposureId: z.string().min(1), sets: z.number() }),
  z.strictObject({
    kind: z.literal('swap_remaining'),
    exposureId: z.string().min(1),
    exercise: ref,
  }),
  z.strictObject({
    kind: z.literal('reduce_remaining'),
    exposureId: z.string().min(1),
    dropSets: z.number().optional(),
    easier: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal('skip_remaining'), exposureId: z.string().min(1) }),
]);
const commandSchema = z.strictObject({
  commandId: z.string().min(1),
  sessionId: z.string().min(1),
  patchId: z.string().regex(/^[0-9a-f]{64}$/),
  change: changeSchema,
  expected: z.strictObject({
    planRevision: z.number().int().positive(),
    historyRevision: z.number().int().nonnegative(),
  }),
  acknowledged: z.array(z.enum(RULE_CODES)),
  channel: z.enum(['touch', 'voice', 'ai_proposal']),
});

/** Re-evaluate, authorize and persist the pending revision atomically (P4b.4, T68/T69). */
export function applySessionChange(
  cmd: ApplySessionChangeCommand,
  now: Date = new Date(),
): CommandResult<{ planRevision: number }> {
  return store.transact(cmd.commandId, (tx) => {
    const known = findCommand(tx, cmd.commandId);
    if (
      known !== null &&
      (known.kind !== 'apply_session_change' || known.workoutId !== cmd.sessionId)
    )
      return {
        kind: 'rejected',
        code: 'INVALID_COMMAND',
        detail: 'command id belongs to another operation',
      };
    const again = store.replay<{ planRevision: number }>(tx, cmd.commandId);
    if (again) return again;
    const parsed = commandSchema.safeParse(cmd);
    if (!parsed.success)
      return { kind: 'rejected', code: 'INVALID_COMMAND', detail: z.prettifyError(parsed.error) };
    const found = store.sessionFor(tx, cmd.sessionId, true);
    if (!found.ok) return found.result;
    const { workout, plan } = found;
    const validPlan = sessionPlanSchema.safeParse(plan);
    if (!validPlan.success || plan.planRevision !== workout.planRevision)
      return {
        kind: 'rejected',
        code: 'INVALID_PLAN',
        detail: 'stored plan schema or revision is invalid',
      };
    const historyRevision = readRevision(tx, 'history');
    if (
      workout.planRevision !== cmd.expected.planRevision ||
      historyRevision !== cmd.expected.historyRevision
    )
      return {
        kind: 'conflict',
        code: 'STALE_INPUT',
        actualRevision: workout.planRevision,
        detail: 'plan or history revision changed',
      };
    const source = readSessionChangeSource(tx, plan);
    if (source.problems.length > 0)
      return { kind: 'rejected', code: 'INVALID_PLAN', detail: JSON.stringify(source.problems) };
    const a = assessSessionChange(source.snap, source.session, parsed.data.change, {
      maxAlternatives: 0,
    });
    if (a.patch === null)
      return { kind: 'rejected', code: 'CHANGE_BLOCKED', detail: JSON.stringify(a.checks) };
    if (a.patch.patchId !== cmd.patchId)
      return {
        kind: 'conflict',
        code: 'STALE_INPUT',
        actualRevision: workout.planRevision,
        detail: 'assessed patch changed',
      };
    const required = adviceToAcknowledge(a.checks);
    const missing = required.filter((code) => !cmd.acknowledged.includes(code));
    if (missing.length > 0)
      return { kind: 'rejected', code: 'ACK_REQUIRED', detail: missing.join(',') };
    // Only current advice failures can be acknowledged; unrelated or hard codes confer no permission.
    const overrides = [...new Set(cmd.acknowledged.filter((c) => required.includes(c)))].sort(
      compareCodePoints,
    );
    const { audit: _audit, ...draft } = a.patch.plan;
    const revised = stampPlan(draft, {
      mode: 'resume_session',
      snapshotFingerprint: source.snap.session.snapshotFingerprint,
      overrides,
    });
    const at = now.toISOString();
    tx.insert(sessionPlanRevisions)
      .values({
        workoutId: cmd.sessionId,
        planRevision: revised.planRevision,
        plan: revised,
        reason: 'user_change',
        channel: cmd.channel,
        overrides,
        createdAt: at,
      })
      .run();
    // Preserve the retired prescriptions in revision history and their dispositions; invent no actual.
    for (const op of a.patch.ops) {
      if (!('setIds' in op)) continue;
      for (const plannedSetId of op.setIds)
        tx.insert(setDispositions)
          .values({
            workoutId: cmd.sessionId,
            plannedSetId,
            status: 'skipped',
            reason: 'replaced',
            commandId: cmd.commandId,
            at,
          })
          .run();
    }
    tx.update(workouts)
      .set({ sessionPlan: revised, planRevision: revised.planRevision })
      .where(eq(workouts.id, cmd.sessionId))
      .run();
    // Pending prescriptions are the volume reservation read by the next snapshot; touch raises history.
    store.touch(tx, cmd.sessionId);
    return store.commit(
      tx,
      { commandId: cmd.commandId, kind: 'apply_session_change', workoutId: cmd.sessionId },
      { planRevision: revised.planRevision },
      now,
    );
  });
}
