import {
  addDays,
  daysBetween,
  hasStreakEnding,
  toIsoDate,
  trainingDate,
} from '../time/trainingDate';

describe('trainingDate', () => {
  it('assigns a late-night session to the previous day', () => {
    const justAfterMidnight = new Date(2026, 8, 12, 0, 40);
    expect(trainingDate(justAfterMidnight, 4)).toBe('2026-09-11');
  });

  it('assigns a session after the boundary to the current day', () => {
    const morning = new Date(2026, 8, 12, 6, 0);
    expect(trainingDate(morning, 4)).toBe('2026-09-12');
  });

  it('treats the boundary hour itself as the new day', () => {
    expect(trainingDate(new Date(2026, 8, 12, 4, 0), 4)).toBe('2026-09-12');
    expect(trainingDate(new Date(2026, 8, 12, 3, 59), 4)).toBe('2026-09-11');
  });

  it('behaves like the calendar when the boundary is midnight', () => {
    const instant = new Date(2026, 8, 12, 0, 40);
    expect(trainingDate(instant, 0)).toBe(toIsoDate(instant));
  });

  it('rejects an out-of-range boundary', () => {
    expect(() => trainingDate(new Date(), 24)).toThrow(RangeError);
    expect(() => trainingDate(new Date(), -1)).toThrow(RangeError);
  });
});

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-09-01', '2026-09-04')).toBe(3);
  });

  it('is signed', () => {
    expect(daysBetween('2026-09-04', '2026-09-01')).toBe(-3);
  });

  it('crosses a month boundary', () => {
    expect(daysBetween('2026-08-30', '2026-09-02')).toBe(3);
  });

  it('is unaffected by daylight saving transitions', () => {
    // Poland moves off DST on 2026-10-25; a naive local-time subtraction
    // would return 0.958 days here and round the layoff rules wrong.
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('rejects malformed input', () => {
    expect(() => daysBetween('wczoraj', '2026-09-01')).toThrow(TypeError);
  });
});

describe('addDays', () => {
  it('moves forward and backward across month and year boundaries', () => {
    expect(addDays('2026-09-15', 3)).toBe('2026-09-18');
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-09-15', 0)).toBe('2026-09-15');
  });

  it('rejects malformed input', () => {
    expect(() => addDays('yesterday', 1)).toThrow(TypeError);
  });
});

describe('hasStreakEnding', () => {
  const set = (...dates: string[]) => new Set(dates);

  it('accepts a run ending today or yesterday', () => {
    expect(hasStreakEnding(set('2026-10-08', '2026-10-09', '2026-10-10'), '2026-10-10', 3)).toBe(
      true,
    );
    expect(hasStreakEnding(set('2026-10-07', '2026-10-08', '2026-10-09'), '2026-10-10', 3)).toBe(
      true,
    );
  });

  it('rejects a broken or an older run', () => {
    expect(hasStreakEnding(set('2026-10-08', '2026-10-10'), '2026-10-10', 2)).toBe(false);
    expect(hasStreakEnding(set('2026-10-06', '2026-10-07', '2026-10-08'), '2026-10-10', 3)).toBe(
      false,
    );
  });
});
