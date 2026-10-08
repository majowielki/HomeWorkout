import { addDays } from '@/domain/time/trainingDate';
import { weekdayOf } from '@/domain/plan/constraints';

/** A fixed Monday-first 6 × 7 grid, including adjacent-month dates. */
export function monthGrid(month: string): string[] {
  const first = `${month.slice(0, 7)}-01`;
  const start = addDays(first, -weekdayOf(first));
  return Array.from({ length: GRID_DAYS }, (_, i) => addDays(start, i));
}

export function shiftMonth(month: string, offset: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(y, m - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('pl-PL', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T12:00:00Z`));
}

/** Six weeks of seven days: the grid always has the same height. */
export const GRID_DAYS = 42;

/** The first and last date the month's grid shows. */
export function gridRange(month: string): { from: string; until: string } {
  const dates = monthGrid(month);
  return { from: dates[0]!, until: dates[GRID_DAYS - 1]! };
}
