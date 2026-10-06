import { pl } from '@/strings/pl';

/** YMove writes both "rear delts" and "rear_deltoids"; one key form covers both. */
const toKey = (id: string) =>
  id
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

/** Polish name of a YMove muscle; an id we have not translated reads as plain words. */
export function muscleLabel(id: string): string {
  const key = toKey(id);
  return pl.labels.ymoveMuscle[key] ?? key.replace(/_/g, ' ');
}

/** Labels for a list, without repeats ("tylne aktony barków" can arrive under two ids). */
export function muscleLabels(ids: readonly string[]): string[] {
  return [...new Set(ids.map(muscleLabel))];
}
