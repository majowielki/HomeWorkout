import { daysBetween, toIsoDate, trainingDate } from '../time/trainingDate';

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
