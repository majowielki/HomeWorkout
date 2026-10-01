/**
 * Locale-aware date rendering for the few places that show a calendar day
 * to the user. Hermes ships Intl on Android, but a missing locale must
 * degrade to the ISO string rather than crash a list.
 */
export function formatDate(isoDate: string, style: 'short' | 'long' = 'short'): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return isoDate;
  try {
    return new Intl.DateTimeFormat(
      'pl-PL',
      style === 'short'
        ? { weekday: 'short', day: 'numeric', month: 'short' }
        : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
    ).format(date);
  } catch {
    return isoDate;
  }
}

export function formatTime(isoInstant: string): string {
  const date = new Date(isoInstant);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
