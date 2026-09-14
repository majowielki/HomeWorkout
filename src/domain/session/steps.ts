import type { TemplateBlock } from '../types';

/**
 * One unit of work in an active session: "do set N of this block".
 *
 * Blocks sharing a superset group (label's leading letters — 'A1' and 'A2'
 * both belong to group 'A') are interleaved set-by-set rather than run
 * back to back, matching how a superset is actually performed: A1 set 1,
 * A2 set 1, A1 set 2, A2 set 2, ... See Documents/IMPLEMENTACJA.md §2.3.
 */
export interface SessionStep {
  block: TemplateBlock;
  blockIndex: number;
  setNumber: number;
  isLastSetOfBlock: boolean;
  /** The next step after this one, if any — drives the "up next" preview. */
  next: { block: TemplateBlock; setNumber: number } | null;
}

function groupKey(label: string): string {
  return label.match(/^[A-Za-z]+/)?.[0] ?? label;
}

export function buildSessionSteps(blocks: readonly TemplateBlock[]): SessionStep[] {
  type Indexed = { block: TemplateBlock; blockIndex: number };
  const groups = new Map<string, Indexed[]>();

  blocks.forEach((block, blockIndex) => {
    const key = groupKey(block.label);
    const list = groups.get(key) ?? [];
    list.push({ block, blockIndex });
    groups.set(key, list);
  });

  const raw: { block: TemplateBlock; blockIndex: number; setNumber: number }[] = [];

  for (const members of groups.values()) {
    const maxSets = Math.max(...members.map((m) => m.block.sets));
    for (let setNumber = 1; setNumber <= maxSets; setNumber += 1) {
      for (const member of members) {
        if (setNumber <= member.block.sets) {
          raw.push({ block: member.block, blockIndex: member.blockIndex, setNumber });
        }
      }
    }
  }

  return raw.map((step, i) => {
    const nextRaw = raw[i + 1];
    return {
      block: step.block,
      blockIndex: step.blockIndex,
      setNumber: step.setNumber,
      isLastSetOfBlock: step.setNumber === step.block.sets,
      next: nextRaw ? { block: nextRaw.block, setNumber: nextRaw.setNumber } : null,
    };
  });
}

/**
 * The identity of a step inside one workout. Written verbatim into
 * set_logs (exercise_order, set_index) at save time and read back to
 * reconstruct progress — keep every producer and consumer on this one
 * function so the two sides cannot drift apart.
 */
export function stepKey(blockIndex: number, setNumber: number): string {
  return `${blockIndex}:${setNumber}`;
}

/**
 * Index of the first not-yet-logged step at or after `from`, or null when
 * everything from that point on is done.
 *
 * Used both to pick the resume point after an app restart (from = 0) and
 * to advance after a set — the latter matters when the user has jumped
 * around via the progress sheet: naively doing `index + 1` could land on a
 * step that already has a log and produce a duplicate row.
 */
export function nextUnloggedIndex(
  steps: readonly SessionStep[],
  loggedPairs: ReadonlySet<string>,
  from = 0,
): number | null {
  for (let i = Math.max(0, from); i < steps.length; i += 1) {
    const s = steps[i]!;
    if (!loggedPairs.has(stepKey(s.blockIndex, s.setNumber))) return i;
  }
  return null;
}

/**
 * Where to resume after a restart: the first unlogged step, or
 * `steps.length` when the session is fully logged. See SPEC §7.1.
 */
export function findResumeIndex(
  steps: readonly SessionStep[],
  loggedPairs: ReadonlySet<string>,
): number {
  return nextUnloggedIndex(steps, loggedPairs, 0) ?? steps.length;
}
