/**
 * A training day does not end at midnight. A session finished at 00:40
 * belongs to the previous day's log, so every date in the training domain
 * is computed against a configurable boundary hour (default 04:00).
 *
 * Body weight is deliberately NOT shifted this way — you weigh yourself in
 * the morning, so the calendar date is unambiguous there.
 */

const MS_PER_HOUR = 60 * 60 * 1000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar date as 'YYYY-MM-DD'. */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Which training day the given instant falls on. */
export function trainingDate(now: Date, boundaryHour: number): string {
  if (!Number.isInteger(boundaryHour) || boundaryHour < 0 || boundaryHour > 23) {
    throw new RangeError(`boundaryHour must be an integer 0-23, got ${boundaryHour}`);
  }
  return toIsoDate(new Date(now.getTime() - boundaryHour * MS_PER_HOUR));
}

/** Whole days between two 'YYYY-MM-DD' strings; negative if `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    throw new TypeError(`expected YYYY-MM-DD dates, got "${from}" and "${to}"`);
  }
  return Math.round((b - a) / (24 * MS_PER_HOUR));
}
