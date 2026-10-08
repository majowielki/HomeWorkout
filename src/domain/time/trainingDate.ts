/**
 * A training day does not end at midnight. A session finished at 00:40
 * belongs to the previous day's log, so every date in the training domain
 * is computed against a configurable boundary hour (default 04:00).
 *
 * Body weight is deliberately NOT shifted this way — you weigh yourself in
 * the morning, so the calendar date is unambiguous there.
 */

export const MS_PER_HOUR = 60 * 60 * 1000;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Until 04:00 it is still yesterday (IMPLEMENTACJA §7.3); the person can change it in Settings. */
export const DEFAULT_DAY_BOUNDARY_HOUR = 4;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar date as 'YYYY-MM-DD'. */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function assertBoundary(boundaryHour: number): void {
  if (!Number.isInteger(boundaryHour) || boundaryHour < 0 || boundaryHour > 23) {
    throw new RangeError(`boundaryHour must be an integer 0-23, got ${boundaryHour}`);
  }
}

/**
 * Which training day the given instant falls on, in the device's own time
 * zone. Before the boundary hour it is still the previous *calendar* date,
 * not "the instant minus N hours", which is an hour off on the two nights a
 * year the clocks change. The local getters already resolve a repeated or
 * skipped hour, so the clock on the wall is what counts.
 */
export function trainingDate(now: Date, boundaryHour: number): string {
  assertBoundary(boundaryHour);
  if (Number.isNaN(now.getTime())) throw new RangeError('trainingDate needs a valid instant');
  const date = toIsoDate(now);
  return now.getHours() < boundaryHour ? addDays(date, -1) : date;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * The same rule in an explicit IANA zone (engine v2, 13 §1): a session stores
 * the zone it started in, and a test can state the zone instead of depending
 * on the machine it runs on. Throws RangeError for a boundary outside 0-23
 * or an unknown zone.
 */
export function trainingDateOf(instant: Date, timeZone: string, boundaryHour: number): string {
  assertBoundary(boundaryHour);
  const part = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  ) as Record<'year' | 'month' | 'day' | 'hour', string>;
  const date = `${part.year}-${part.month}-${part.day}`;
  return Number(part.hour) < boundaryHour ? addDays(date, -1) : date;
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

/**
 * Whether `days` consecutive dates from the set end today or yesterday.
 * Yesterday too: last night's sleep and this morning's soreness are logged
 * during the day, and an empty "today" must not hide a run that is there.
 */
export function hasStreakEnding(dates: ReadonlySet<string>, asOf: string, days: number): boolean {
  return [asOf, addDays(asOf, -1)].some((end) =>
    Array.from({ length: days }, (_, i) => addDays(end, -i)).every((d) => dates.has(d)),
  );
}

/** The 'YYYY-MM-DD' that lies `days` calendar days after `date` (negative moves back). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  if ([y, m, d].some((n) => Number.isNaN(n))) {
    throw new TypeError(`expected a YYYY-MM-DD date, got "${date}"`);
  }
  return toIsoDate(new Date(y, m - 1, d + days));
}
