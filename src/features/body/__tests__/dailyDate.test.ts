import { dailyLogDate } from '../dailyDate';

it('opens the report date after midnight while leaving normal diary navigation on today', () => {
  expect(dailyLogDate('2026-10-07', '2026-10-08')).toBe('2026-10-07');
  expect(dailyLogDate(undefined, '2026-10-08')).toBe('2026-10-08');
  expect(dailyLogDate('2026-10-08', '2026-10-08')).toBe('2026-10-08');
});
it('does not enable arbitrary historical or future editing through a link parameter', () => {
  expect(dailyLogDate('2026-09-08', '2026-10-08')).toBe('2026-10-08');
  expect(dailyLogDate('2026-10-09', '2026-10-08')).toBe('2026-10-08');
  expect(dailyLogDate('invalid', '2026-10-08')).toBe('2026-10-08');
});
