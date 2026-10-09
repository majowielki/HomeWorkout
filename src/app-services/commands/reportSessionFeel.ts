import {
  reportSessionFeel as persistFeel,
  type ReportSessionFeelCommand,
  type ReportedSessionFeel,
} from '@/db/repositories/sessionFeel';
import type { CommandResult } from '@/domain/commands/result';

export type { ReportSessionFeelCommand, ReportedSessionFeel } from '@/db/repositories/sessionFeel';

export async function reportSessionFeel(
  cmd: ReportSessionFeelCommand,
  now: Date = new Date(),
): Promise<CommandResult<ReportedSessionFeel>> {
  return persistFeel(cmd, now);
}
