/**
 * What a command that changes something answers (engine v2, 10 §1).
 *
 * The answer says whether the change happened *now*, happened *before* (the
 * same command was sent twice), was refused because the state had moved on,
 * or could not be done at all. A screen moves to the next step only on
 * `committed`; after a lost answer it sends the same command again and gets
 * the stored result, so nothing is written twice.
 */

export type ConflictCode =
  /** The session changed since the command was made (its revision is not the one expected). */
  | 'SESSION_CHANGED'
  /** The planned set already has a result; a correction is a different command. */
  | 'SET_ALREADY_RECORDED'
  /** A newer command undid what this one did; sending it again would not bring it back. */
  | 'COMMAND_SUPERSEDED'
  /** Another session is running. */
  | 'ACTIVE_SESSION_EXISTS'
  /** What the command was made from (a preview, an assessment) is out of date. */
  | 'STALE_INPUT';

export type RejectionCode =
  | 'INVALID_COMMAND'
  | 'UNKNOWN_SESSION'
  | 'SESSION_NOT_ACTIVE'
  | 'UNKNOWN_PLANNED_SET'
  | 'UNKNOWN_OBSERVATION'
  | 'INVALID_PLAN';

export type CommandResult<T> =
  | { kind: 'committed'; result: T; sessionRevision: number }
  | { kind: 'already_committed'; result: T; sessionRevision: number }
  | { kind: 'conflict'; code: ConflictCode; actualRevision: number | null; detail?: string }
  | { kind: 'rejected'; code: RejectionCode; detail: string }
  /**
   * The store failed and nothing was written. The client cannot tell whether the answer was lost or the write
   * was; sending the same command again is safe either way.
   */
  | { kind: 'storage_error'; retryable: boolean; commandId: string; detail: string };

export const isDone = <T>(r: CommandResult<T>): r is Extract<CommandResult<T>, { result: T }> =>
  r.kind === 'committed' || r.kind === 'already_committed';
