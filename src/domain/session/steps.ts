import type { Side, TemplateBlock } from '../types';

/**
 * One unit of work in an active session: "do set N of this block".
 *
 * Blocks sharing a superset group (label's leading letters — 'A1' and 'A2'
 * both belong to group 'A') are interleaved set-by-set rather than run
 * back to back, matching how a superset is actually performed: A1 set 1,
 * A2 set 1, A1 set 2, A2 set 2, ... See Documents/IMPLEMENTACJA.md §2.3.
 *
 * An exercise done one side per set (`sides: 'perSet'`) has two steps per
 * set, one per side. Its `setNumber` counts the steps (1-2 are set 1, left
 * and right), so every step keeps its own log; `round` is the set.
 */
export interface SessionStep {
  block: TemplateBlock;
  blockIndex: number;
  /** The step's number within its block, as stored in set_logs.set_index. */
  setNumber: number;
  /** Which set of the block this is, 1..block.sets — "seria 2 / 3". */
  round: number;
  /** The side of a one-sided set; null for two-sided work. */
  side: Side | null;
  /** This step's position among its block's steps (0-based), and how many there are. */
  stepOfBlock: number;
  stepsInBlock: number;
  isLastSetOfBlock: boolean;
  /** The next step after this one, if any — drives the "up next" preview. */
  next: { block: TemplateBlock; setNumber: number; side: Side | null } | null;
}

export interface StepOptions {
  /**
   * The order of the two sides for a block whose exercise is done one side
   * per set, or null when it is two-sided. Absent: everything two-sided.
   */
  sidesOf?: (block: TemplateBlock, blockIndex: number) => readonly [Side, Side] | null;
}

/** 'A' for 'A1' and 'A2': blocks with the same key are one superset. */
export function groupKey(label: string): string {
  return label.match(/^[A-Za-z]+/)?.[0] ?? label;
}

/** Block indices of the superset `blockIndex` belongs to, in plan order (just itself when alone). */
export function groupBlockIndices(steps: readonly SessionStep[], blockIndex: number): number[] {
  const own = steps.find((s) => s.blockIndex === blockIndex);
  if (!own) return [];
  const key = groupKey(own.block.label);
  const indices = new Set<number>();
  for (const s of steps) if (groupKey(s.block.label) === key) indices.add(s.blockIndex);
  return [...indices];
}

/** True when every set of every exercise in `blockIndex`'s superset has a log. */
export function isGroupComplete(
  steps: readonly SessionStep[],
  loggedPairs: ReadonlySet<string>,
  blockIndex: number,
): boolean {
  const group = new Set(groupBlockIndices(steps, blockIndex));
  return steps
    .filter((s) => group.has(s.blockIndex))
    .every((s) => loggedPairs.has(stepKey(s.blockIndex, s.setNumber)));
}

export function buildSessionSteps(
  blocks: readonly TemplateBlock[],
  options: StepOptions = {},
): SessionStep[] {
  type Indexed = { block: TemplateBlock; blockIndex: number };
  type Raw = Indexed & { setNumber: number; round: number; side: Side | null };
  const groups = new Map<string, Indexed[]>();

  blocks.forEach((block, blockIndex) => {
    const key = groupKey(block.label);
    const list = groups.get(key) ?? [];
    list.push({ block, blockIndex });
    groups.set(key, list);
  });

  const raw: Raw[] = [];
  for (const members of groups.values()) {
    const maxSets = Math.max(...members.map((m) => m.block.sets));
    for (let round = 1; round <= maxSets; round += 1) {
      for (const member of members) {
        if (round > member.block.sets) continue;
        const sides = options.sidesOf?.(member.block, member.blockIndex) ?? null;
        if (sides === null) {
          raw.push({ ...member, setNumber: round, round, side: null });
        } else {
          sides.forEach((side, i) =>
            raw.push({ ...member, setNumber: (round - 1) * 2 + i + 1, round, side }),
          );
        }
      }
    }
  }

  const ordered = spread(raw);
  const count = new Map<number, number>();
  for (const step of ordered) count.set(step.blockIndex, (count.get(step.blockIndex) ?? 0) + 1);
  const seen = new Map<number, number>();

  return ordered.map((step, i) => {
    const nextRaw = ordered[i + 1];
    const stepOfBlock = seen.get(step.blockIndex) ?? 0;
    seen.set(step.blockIndex, stepOfBlock + 1);
    const stepsInBlock = count.get(step.blockIndex)!;
    return {
      block: step.block,
      blockIndex: step.blockIndex,
      setNumber: step.setNumber,
      round: step.round,
      side: step.side,
      stepOfBlock,
      stepsInBlock,
      isLastSetOfBlock: stepOfBlock === stepsInBlock - 1,
      next: nextRaw
        ? { block: nextRaw.block, setNumber: nextRaw.setNumber, side: nextRaw.side }
        : null,
    };
  });
}

/**
 * The same exercise twice in a row gives its muscles no rest — it happens
 * at the tail of a superset whose members have different set counts, in a
 * lone exercise, and between the two sides of a one-sided set. Whenever
 * the next step would repeat the exercise just done, the first step of any
 * other exercise further down moves up in between. Each exercise keeps the
 * order of its own sets; when nothing else is left, the repeat stays.
 */
function spread<T extends { blockIndex: number }>(steps: readonly T[]): T[] {
  const rest = [...steps];
  const out: T[] = [];
  while (rest.length > 0) {
    const previous = out[out.length - 1];
    const other = previous ? rest.findIndex((s) => s.blockIndex !== previous.blockIndex) : 0;
    out.push(rest.splice(Math.max(0, other), 1)[0]!);
  }
  return out;
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
