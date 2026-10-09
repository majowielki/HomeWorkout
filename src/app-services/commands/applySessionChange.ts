/** Async application contract over one synchronous SQLite transaction, shared with the v2 commands. */
import {
  applySessionChange as persistChange,
  type ApplySessionChangeCommand,
} from '@/db/repositories/sessionChanges';
import type { CommandResult } from '@/domain/commands/result';

export type { ApplySessionChangeCommand } from '@/db/repositories/sessionChanges';
export async function applySessionChange(
  cmd: ApplySessionChangeCommand,
  now: Date = new Date(),
): Promise<CommandResult<{ planRevision: number }>> {
  return persistChange(cmd, now);
}
export { loadSessionChangeSource } from '@/db/repositories/sessionChangeSource';
