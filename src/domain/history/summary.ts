/**
 * Read-only shaping of a logged session for the history screens.
 * Pure: takes rows as plain objects, never touches the database.
 */

/** The columns of a set log that history needs; structurally matches the DB row. */
export interface HistorySet {
  id: string;
  exerciseId: string;
  exerciseOrder: number;
  setIndex: number;
  isWarmup: boolean;
  loggedAt: string;
}

export interface ExerciseGroup<T extends HistorySet> {
  exerciseId: string;
  exerciseOrder: number;
  sets: T[];
}

/**
 * Sets grouped by their position in the session, in the order they were
 * performed. Within a group sets sort by index, then by time — two logs
 * for the same index (a duplicate that slipped past the guard) still get
 * a stable order instead of jumping around between renders.
 */
export function groupSetsByExercise<T extends HistorySet>(sets: readonly T[]): ExerciseGroup<T>[] {
  const groups = new Map<number, ExerciseGroup<T>>();

  for (const set of sets) {
    const group = groups.get(set.exerciseOrder);
    if (group) {
      group.sets.push(set);
    } else {
      groups.set(set.exerciseOrder, {
        exerciseId: set.exerciseId,
        exerciseOrder: set.exerciseOrder,
        sets: [set],
      });
    }
  }

  return [...groups.values()]
    .sort((a, b) => a.exerciseOrder - b.exerciseOrder)
    .map((group) => ({
      ...group,
      sets: [...group.sets].sort(
        (a, b) => a.setIndex - b.setIndex || a.loggedAt.localeCompare(b.loggedAt),
      ),
    }));
}

export function countWorkingSets(sets: readonly HistorySet[]): number {
  return sets.filter((s) => !s.isWarmup).length;
}

/**
 * Whole minutes between start and finish, or null while the session is
 * still open or when the clock moved backwards in between.
 */
export function durationMinutes(startedAt: string, finishedAt: string | null): number | null {
  if (finishedAt === null) return null;
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.round(ms / 60_000);
}
